import assert from 'assert';
import { chunkText } from '../chunker.js';

// sample text with clear sentence boundaries
const text = 'Sentence one. Sentence two. Sentence three.';
const result = chunkText(text, 20);
// Should split into three sentences
assert.strictEqual(result.length, 3);
// Each chunk should end with a period and be under or equal to maxChars
result.forEach(chunk => {
  assert(chunk.length <= 20, `Chunk too long: ${chunk.length}`);
  assert(/\.$/.test(chunk), 'Chunk does not end with period');
});

// sample with long single sentence exceeding limit
const longSentence = 'This sentence is fairly long so it might exceed the limit.';
const longResult = chunkText(longSentence, 20);
// Should produce chunks none longer than maxChars
longResult.forEach(chunk => {
  assert(chunk.length <= 20, `Chunk too long: ${chunk.length}`);
});

console.log('All chunker tests passed');
