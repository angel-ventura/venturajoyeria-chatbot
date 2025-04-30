// index-docs.js
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

// helper to embed and format
async function embedChunks(docs, namespace) {
  const chunks = docs.flatMap(doc =>
    chunkText(doc.text).map((piece, i) => ({
      id:       `${doc.id}#${i}`,
      values:   [],
      metadata: { chunkText: piece, source: doc.id }
    }))
  );

  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    console.log(`Embedding batch ${i / 100 + 1}/${Math.ceil(chunks.length / 100)}`);
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch.map(c => c.metadata.chunkText)
    });
    res.data.forEach((e, idx) => {
      batch[idx].values = e.embedding;
    });
  }

  console.log(`Upserting ${chunks.length} to namespace "${namespace}"...`);
  await index.upsert({
    namespace,
    upsertRequest: { vectors: chunks }
  });
}

async function main() {
  // 🟩 Sync products
  console.log("Fetching Shopify products…");
  const products = await fetchProducts();
  console.log("→ products:", products.length);

  const productDocs = products.map(p => ({
    id:   `product:${p.id}`,
    text: `${p.metadata.title}\n${p.metadata.price}\n${p.metadata.description}`
  }));

  // 🧹 Clear old product data first
  await index._delete({ namespace: "products", deleteAll: true });
  await embedChunks(productDocs, "products");

  // 🟩 Sync site content
  console.log("Fetching public site pages…");
  const urls = [
    "https://venturajoyeria.com/",
    "https://venturajoyeria.com/pages/sobre-nosotros",
    "https://venturajoyeria.com/policies/shipping-policy",
    "https://venturajoyeria.com/policies/refund-policy"
  ];
  const pages = await Promise.all(urls.map(async url => {
    const { text } = await fetchPageText(url);
    return { id: `page:${url}`, text };
  }));

  await embedChunks(pages, "site-info");

  console.log("✅ Sync complete.");
}

main().catch(err => {
  console.error("❌ Error indexing docs:", err);
  process.exit(1);
});
