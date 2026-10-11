// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTracker } = require('../extension/lib/tracker.js');

function setup() {
  const sent = [];
  let t = 0;
  const tracker = createTracker((m) => sent.push(m), () => t);
  return { sent, tracker, tick: (ms = 400) => (t += ms) };
}
const captions = (sent) => sent.filter((m) => m.type === 'caption');
const ids = (sent) => [...new Set(captions(sent).map((m) => m.id))];

test('a growing caption keeps one id', () => {
  const { sent, tracker } = setup();
  const a = {};
  tracker.update([{ key: a, speaker: 'Amina', text: 'Hello' }]);
  tracker.update([{ key: a, speaker: 'Amina', text: 'Hello everyone' }]);
  assert.deepEqual(ids(sent), [1]);
  assert.equal(captions(sent).at(-1).text, 'Hello everyone');
});

test('a turn re-rendered between two scans keeps its id and sends no early final', () => {
  const { sent, tracker, tick } = setup();
  tracker.update([{ key: {}, speaker: 'Amina', text: 'Hello everyone, welcome to' }]);
  tick();
  tracker.update([{ key: {}, speaker: 'Amina', text: 'Hello everyone, welcome to the call' }]);
  assert.deepEqual(ids(sent), [1]);
  assert.equal(sent.filter((m) => m.type === 'final').length, 0);
  assert.equal(captions(sent).at(-1).text, 'Hello everyone, welcome to the call');
});

test('two speakers keyed by avatar never overwrite each other', () => {
  const { sent, tracker, tick } = setup();
  const alice = {};
  const bob = {};
  tracker.update([{ key: alice, speaker: 'Alice', text: 'Shall we start' }]);
  tick();
  tracker.update([
    { key: alice, speaker: 'Alice', text: 'Shall we start' },
    { key: bob, speaker: 'Bob', text: 'Thanks Alice' },
  ]);
  tick();
  tracker.update([{ key: bob, speaker: 'Bob', text: 'Thanks Alice, yes' }]);
  const byId = Object.groupBy(captions(sent), (m) => m.id);
  assert.deepEqual(Object.keys(byId), ['1', '2']);
  assert.ok(byId[1].every((m) => m.speaker === 'Alice'));
  assert.ok(byId[2].every((m) => m.speaker === 'Bob'));
  assert.deepEqual(sent.filter((m) => m.type === 'final').map((m) => m.id), [1]);
});

test('one element showing an unrelated sentence starts a new turn (Zoom)', () => {
  const { sent, tracker } = setup();
  const line = {};
  tracker.update([{ key: line, speaker: '', text: 'The budget is ready for review.' }]);
  tracker.update([{ key: line, speaker: '', text: 'Next we look at hiring.' }]);
  assert.deepEqual(ids(sent), [1, 2]);
  assert.deepEqual(sent.filter((m) => m.type === 'final').map((m) => m.id), [1]);
});

test('a vanished turn gets a final, and replay resends what is on screen', () => {
  const { sent, tracker, tick } = setup();
  const a = {};
  const b = {};
  tracker.update([{ key: a, speaker: 'A', text: 'First point' }, { key: b, speaker: 'B', text: 'Second point' }]);
  tick(5000);
  tracker.update([{ key: b, speaker: 'B', text: 'Second point' }]);
  assert.deepEqual(sent.filter((m) => m.type === 'final').map((m) => m.id), [1]);
  sent.length = 0;
  tracker.replay();
  assert.deepEqual(sent, [{ type: 'caption', id: 2, speaker: 'B', text: 'Second point' }]);
});
