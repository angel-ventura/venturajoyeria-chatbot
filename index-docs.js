// index-docs.js
import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import pkg from "@pinecone-database/pinecone";
import { fetchProducts, fetchPages } from "./fetch-shopify.js";
import { fetchPageText } from "./fetch-public-pages.js";
import { chunkText } from "./chunker.js";

const { Pinecone } = pkg;

const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone();
const index    = pinecone.Index(process.env.PINECONE_INDEX);

async function main() {
  // FETCH
  console.log("Fetching Shopify products…");
  const products = await fetchProducts();
  console.log("→ products:", products.length);

  console.log("Fetching Shopify pages…");
  const pages = await fetchPages();
  console.log("→ pages:", pages.length);

  console.log("Fetching public pages…");
  const publics = await Promise.all([
    "https://venturajoyeria.com/",
    "https://venturajoyeria.com/pages/sobre-nosotros",
    "https://venturajoyeria.com/policies/shipping-policy",
    "https://venturajoyeria.com/policies/refund-policy"
  ].map(async url => {
    const { text } = await fetchPageText(url);
    return { id: `public:${url}`, text };
  }));
  console.log("→ public pages:", publics.length);

  const allDocs = [...products, ...pages, ...publics];
  console.log("Total raw documents:", allDocs.length);

  // CHUNK
  const chunks = allDocs.flatMap(doc =>
    chunkText(doc.text).map((piece, i) => ({
      id:       `${doc.id}#${i}`,
      text:     piece,
      metadata: { source: doc.id, chunkText: piece }
    }))
  );
  console.log("Total chunks:", chunks.length);

  // EMBED
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
  console.log("Total vectors to upsert:", vectors.length);

  // DELETE old product vectors only
  console.log("🧹 Deleting old product vectors...");
  await index.deleteMany({
    namespace: "products",
    deleteAll: true,
    ids: [] // required to avoid error in some Pinecone deployments
  });

  // UPSERT
  const productVectors = vectors.filter(v => v.metadata.source.startsWith("product:"));
  const siteVectors    = vectors.filter(v => v.metadata.source.startsWith("public:") || v.metadata.source.startsWith("page:"));

  console.log("📦 Upserting product vectors...");
  for (let i = 0; i < productVectors.length; i += 100) {
    await index.upsert({
      namespace: "products",
      vectors: productVectors.slice(i, i + 100)
    });
  }

  console.log("🌐 Upserting site-info vectors...");
  for (let i = 0; i < siteVectors.length; i += 100) {
    await index.upsert({
      namespace: "site-info",
      vectors: siteVectors.slice(i, i + 100)
    });
  }

  console.log("✅ All vectors upserted!");
}

main().catch(err => {
  console.error("❌ Error indexing docs:", err);
  process.exit(1);
});
