// ==================== chunker.js ====================
const { encode } = require('gpt-3-encoder');

/**
 * Splits text into chunks of approx. maxTokens size with overlap.
 * @param {string} text 
 * @param {number} maxTokens 
 * @param {number} overlapTokens 
 * @returns {string[]}
 */
function chunkText(text, maxTokens = 500, overlapTokens = 50) {
  const sentences = text.match(/[^\.\!?]+[\.\!?]+/g) || [text];
  const chunks = [];
  let chunk = [];
  let tokenCount = 0;

  for (const sentence of sentences) {
    const tokens = encode(sentence);
    if (tokenCount + tokens.length > maxTokens && chunk.length) {
      chunks.push(chunk.join(' '));
      // carry over overlap
      const overlapSentences = [];
      let overlapTokensCount = 0;
      while (chunk.length && overlapTokensCount < overlapTokens) {
        const s = chunk.pop();
        const t = encode(s).length;
        overlapTokensCount += t;
        overlapSentences.unshift(s);
      }
      chunk = overlapSentences;
      tokenCount = encode(chunk.join(' ')).length;
    }
    chunk.push(sentence);
    tokenCount += tokens.length;
  }
  if (chunk.length) chunks.push(chunk.join(' '));
  return chunks;
}

module.exports = { chunkText };
