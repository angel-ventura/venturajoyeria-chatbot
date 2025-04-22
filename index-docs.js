// index-docs.js  ── FINAL ──────────────────────────────────────────────────────
import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import pkg from "@pinecone-database/pinecone";

import { fetchProducts, fetchPages } from "./fetch-shopify.js";
import { fetchPageText }             from "./fetch-public-pages.js";
import { chunkText }                 from "./chunker.js";

const { Pinecone } = pkg;
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone();
const index    = pinecone.Index(process.env.PINECONE_INDEX);

async function main() {
  // ── Fetch content ───────────────────────────────────────────────────────────
  const products = await fetchProducts();
  const pages    = await fetchPages();
  const publics  = await Promise.all([
    "https://venturajoyeria.com/",
    "https://venturajoyeria.com/pages/sobre-nosotros",
    "https://venturajoyeria.com/policies/shipping-policy",
    "https://venturajoyeria.com/policies/refund-policy"
  ].map(async url => {
    const { text } = await fetchPageText(url);
    return { id: `public:${url}`, text };
  }));

  const allDocs = [...products, ...pages, ...publics];
  console.log(`Total raw docs: ${allDocs.length}`);

  // ── Chunk ───────────────────────────────────────────────────────────────────
  const chunks = allDocs.flatMap(doc =>
    chunkText(doc.text).map((piece, i) => ({
      id:       `${doc.id}#${i}`,
      text:     piece,
      metadata: { source: doc.id }
    }))
  );
  console.log(`Total chunks: ${chunks.length}`);

  // ── Embed ───────────────────────────────────────────────────────────────────
  const vectors = [];
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    console.log(`Embedding batch ${i/100 + 1}/${Math.ceil(chunks.length/100)}`);
    const resp = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch.map(c => c.text)
    });
    resp.data.forEach((e, idx) => {
      vectors.push({
        id:       batch[idx].id,
        values:   e.embedding,
        metadata: batch[idx].metadata
      });
    });
  }
  console.log(`Total vectors ready: ${vectors.length}`);

  // ── Upsert in ≤100‑vector chunks to stay under 2 MB ─────────────────────────
  const BATCH = 100;
  for (let i = 0; i < vectors.length; i += BATCH) {
    const slice = vectors.slice(i, i + BATCH);
    console.log(`Upserting ${i}-${i+slice.length-1} …`);
    await index.upsert(slice);            // ← first arg = array
  }
  console.log("✅ All vectors upserted!");
}

main().catch(err => {
  console.error("❌ Indexing error:", err);
  process.exit(1);
});
