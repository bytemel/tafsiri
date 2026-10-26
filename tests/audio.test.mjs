// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSegmenter, resample } = require('../extension/lib/segmenter.js');
const { splitIntoChunks } = require('../extension/lib/chunks.js');

const RATE = 16000;
const tone = (ms, amp = 0.2) => Float32Array.from({ length: (RATE * ms) / 1000 }, (_, i) => amp * Math.sin(i / 3));
const quiet = (ms) => Float32Array.from({ length: (RATE * ms) / 1000 }, () => (Math.random() - 0.5) * 0.002);

function run(parts, opts) {
  const segs = [];
  const s = createSegmenter({ onSegment: (data, info) => segs.push({ ms: (data.length / RATE) * 1000, ...info }), ...opts });
  for (const p of parts) s.push(p);
  s.flush();
  return segs;
}

test('speech separated by pauses becomes one segment per phrase', () => {
  const segs = run([quiet(1000), tone(1500), quiet(1000), tone(2000), quiet(1000)]);
  assert.equal(segs.length, 2);
  assert.ok(segs[0].ms > 1400 && segs[0].ms < 2200, `first was ${segs[0].ms} ms`);
  assert.ok(segs[1].ms > 1900 && segs[1].ms < 2700, `second was ${segs[1].ms} ms`);
});

test('a soft voice is still heard (it must not be learned as background noise)', () => {
  // RMS about 0.02, below the old starting threshold of 0.03.
  const segs = run([quiet(1000), tone(1500, 0.028), quiet(1000), tone(1500, 0.028), quiet(1000)]);
  assert.equal(segs.length, 2);
});

test('a steady background hum is not heard as speech for long', () => {
  const hum = (ms) => Float32Array.from({ length: (RATE * ms) / 1000 }, () => (Math.random() - 0.5) * 0.02);
  const segs = run([hum(60000)]);
  const total = segs.reduce((n, s) => n + s.ms, 0);
  assert.ok(total < 30000, `treated ${Math.round(total)} ms of 60000 ms hum as speech`);
});

test('silence and short clicks produce nothing', () => {
  assert.equal(run([quiet(3000)]).length, 0);
  assert.equal(run([quiet(1000), tone(100), quiet(1000)]).length, 0);
});

test('a long speech without pauses is cut so subtitles keep up', () => {
  const segs = run([quiet(500), tone(16000), quiet(1000)], { maxMs: 7000 });
  assert.ok(segs.length >= 3, `got ${segs.length} segments`);
  assert.ok(segs.every((s) => s.ms <= 7100), segs.map((s) => Math.round(s.ms)).join(', '));
  const total = segs.reduce((n, s) => n + s.ms, 0);
  assert.ok(total > 15500, `kept ${Math.round(total)} ms of 16000`);
});

test('48 kHz input is resampled to 16 kHz', () => {
  const out = resample(new Float32Array(48000), 48000);
  assert.equal(out.length, 16000);
  const segs = run([resample(quiet(500), 16000, 48000), resample(tone(1000), 16000, 48000), resample(quiet(1000), 16000, 48000)], { sampleRate: 48000 });
  assert.equal(segs.length, 1);
});

test('long turns split into subtitle chunks at sentence ends', () => {
  const text = 'Good morning everyone. Thanks for joining the review today. We will start with the budget and then look at the launch plan for next month. Please keep your questions until the end. After that we will talk about hiring.';
  const chunks = splitIntoChunks(text, 120);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.length <= 150), chunks.join(' | '));
  assert.equal(chunks.join(' '), text);
});

test('a run-on without punctuation still gets wrapped', () => {
  const text = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
  const chunks = splitIntoChunks(text, 100);
  assert.ok(chunks.length >= 4);
  assert.ok(chunks.every((c) => c.length <= 150));
  assert.equal(chunks.join(' '), text);
});

test('short text stays one chunk', () => {
  assert.deepEqual(splitIntoChunks('Habari zako? Hujambo?'), ['Habari zako? Hujambo?']);
  assert.deepEqual(splitIntoChunks(''), []);
});
