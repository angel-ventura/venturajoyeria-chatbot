// fetch-pdf.js
import fs from "fs";
import pdf from "pdf-parse";

/**
 * Read a PDF and break into paragraph‐sized chunks.
 * @param {string} filePath – path to your PDF (e.g. "instructions.pdf")
 * @param {string}  idPrefix – how to namespace these chunks
 */
export async function fetchPdfChunks(filePath = "instructions.pdf", idPrefix = "instructions") {
  const dataBuffer = fs.readFileSync(filePath);
  const { text }    = await pdf(dataBuffer);

  // split on double‐newlines, drop very short pieces
  const paras = text
    .split(/\n\s*\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 30);

  return paras.map((txt, i) => ({
    id:   `${idPrefix}:${i}`,
    text: txt
  }));
}
