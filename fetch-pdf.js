// fetch-pdf.js
import fs from "fs";
import pdf from "pdf-parse";

/**
 * Extrae texto de un PDF y lo divide en fragmentos
 */
export async function fetchPdfChunks(filePath, idPrefix = "pdf") {
  const dataBuffer = fs.readFileSync(filePath);
  const { text } = await pdf(dataBuffer);

  // Divide por saltos de línea dobles (párrafos)
  const paras = text
    .split(/\n\s*\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 30); // evita texto muy corto

  return paras.map((text, i) => ({
    id: `${idPrefix}#${i}`,
    text,
  }));
}
