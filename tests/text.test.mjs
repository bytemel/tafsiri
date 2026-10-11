// Run: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mergeCaption, splitSentences, cleanLines } = require('../extension/lib/text.js');

test('caption that grows keeps the new text', () => {
  assert.equal(mergeCaption('Good morning', 'Good morning everyone'), 'Good morning everyone');
});

test('live correction of the last words takes the corrected text', () => {
  assert.equal(mergeCaption('We will meat on Friday', 'We will meet on Friday'), 'We will meet on Friday');
  assert.equal(mergeCaption('I want to go two', 'I want to go'), 'I want to go');
});

test('caption trimmed from the top is stitched back onto the old text', () => {
  const prev = 'one two three four five six seven';
  const next = 'four five six seven eight nine';
  assert.equal(mergeCaption(prev, next), 'one two three four five six seven eight nine');
});

test('a trimmed caption with nothing new keeps the full text', () => {
  assert.equal(mergeCaption('alpha beta gamma delta epsilon', 'gamma delta'), 'alpha beta gamma delta epsilon');
});

test('unrelated text replaces the old text', () => {
  assert.equal(mergeCaption('Hello', 'Bonjour'), 'Bonjour');
  assert.equal(mergeCaption('', 'First'), 'First');
});

test('sentences split on end punctuation', () => {
  assert.deepEqual(splitSentences('Hi there. How are you? Fine'), ['Hi there.', 'How are you?', 'Fine']);
  assert.deepEqual(splitSentences('你好。谢谢！'), ['你好。', '谢谢！']);
  assert.deepEqual(splitSentences(''), []);
});

test('caption lines drop buttons and icon ligatures', () => {
  const raw = 'Wanjiru Kamau\nLet us start the review\narrow_downward\nJump to bottom';
  assert.deepEqual(cleanLines(raw, ['Jump to bottom']), ['Wanjiru Kamau', 'Let us start the review']);
});

test('continuesCaption tells a new sentence from an update', async () => {
  const { continuesCaption } = require('../extension/lib/text.js');
  assert.equal(continuesCaption('The budget is', 'The budget is ready'), true);
  assert.equal(continuesCaption('The budget is ready for review.', 'Next we look at hiring.'), false);
});
