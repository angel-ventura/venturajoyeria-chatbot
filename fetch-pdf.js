// fetch-pdf.js
import fs from "fs";

export async function fetchPdfChunks(filePath = "instructions.pdf", idPrefix = "instructions") {
  // If the PDF isn’t in the repo (e.g. on CI), just skip it:
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  ${filePath} not found, skipping PDF instructions.`);
    return [];
  }

  // only now do we load pdf-parse (and only if we need it):
  const pdfMod  = await import("pdf-parse/lib/pdf-parse.js");
  const parse   = pdfMod.default ?? pdfMod;

  const dataBuf = fs.readFileSync(filePath);
  const { text } = await parse(dataBuf);

  // split on double‐newlines into “paragraph” chunks
  const paras = text
    .split(/\n\s*\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 30);

  return paras.map((txt, i) => ({
    id:   `${idPrefix}:${i}`,
    text: txt
  }));
}

