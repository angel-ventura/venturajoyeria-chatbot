// chunker.js
/**
 * Split a long text into chunks up to maxChars, preferring sentence boundaries.
 * @param {string} text - The text to split
 * @param {number} maxChars - Approximate maximum chars per chunk
 * @returns {string[]} Array of text chunks
 */
export function chunkText(text, maxChars = 1000) {
  const chunks = [];
  let start = 0;
  const len = text.length;
  while (start < len) {
    let end = Math.min(start + maxChars, len);
    // Try to split on a period
    let split = text.lastIndexOf('.', end);
    if (split <= start) {
      // Try newline
      split = text.lastIndexOf('\n', end);
    }
    if (split <= start) {
      // fallback to max length
      split = end;
    }
    // include the split character if it's a period
    const sliceEnd = split + (text[split] === '.' ? 1 : 0);
    const chunk = text.slice(start, sliceEnd).trim();
    if (chunk) chunks.push(chunk);
    start = sliceEnd;
  }
  return chunks;
}
