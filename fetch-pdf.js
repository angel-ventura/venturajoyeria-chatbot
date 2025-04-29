// fetch-pdf.js
import fs   from "fs";
import pdf  from "pdf-parse";

/**
 * Read a PDF file, extract its full text, split into paragraphs.
 * Returns array of { id, text }.
 */
export async function fetchPdfChunks(filePath, idPrefix = "instr") {
  const data    = fs.readFileSync(filePath);
  const { text } = await pdf(data);

  // break on double new-lines, drop very short pieces
  const paras = text
    .split(/\n\s*\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 50);

  return paras.map((p,i)=>({
    id:   `${idPrefix}:${i}`,
    text: p
  }));
}
