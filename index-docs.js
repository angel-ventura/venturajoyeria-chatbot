// index-docs.js
import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import pkg from "@pinecone-database/pinecone";

import {
  fetchProducts,
  fetchPages,
  fetchShippingPolicy,
  fetchDiscountCodes
} from "./fetch-shopify.js";
import { fetchPageText } from "./fetch-public-pages.js";
import { chunkText }     from "./chunker.js";

const { Pinecone } = pkg;
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone();
const index    = pinecone.Index(process.env.PINECONE_INDEX, "");

async function main() {
  console.log("Fetching Shopify products…");
  const products = await fetchProducts();
  console.log(`→ products: ${products.length}`);

  console.log("Fetching Shopify pages…");
  const pages = await fetchPages();
  console.log(`→ pages: ${pages.length}`);

  console.log("Fetching shipping policy…");
  const shipping = await fetchShippingPolicy();
  console.log(`→ shipping policies: ${shipping.length}`);

  console.log("Fetching discount codes…");
  const discounts = await fetchDiscountCodes();
  console.log(`→ discount codes: ${discounts.length}`);

  console.log("Fetching public pages…");
  const publicUrls = [
    "https://venturajoyeria.com/",
    "https://venturajoyeria.com/pages/sobre-nosotros",
    "https://venturajoyeria.com/policies/shipping-policy",
    "https://venturajoyeria.com/policies/refund-policy"
  ];
  const publics = await Promise.all(publicUrls.map(fetchPageText));
  console.log(`→ public pages: ${publics.length}`);

  // Combine
  const allDocs = [
    ...products,
    ...pages,
    ...shipping,
    ...discounts,
    ...publics.map(d => ({ id: `public:${d.url}`, text: d.text }))
  ];
  console.log(`Total raw docs: ${allDocs.length}`);

  // Chunk
  const chunks = allDocs.flatMap(doc => {
    const meta = doc.metadata || {};
    return chunkText(doc.text).map((text, i) => ({
      id:       `${doc.id}#${i}`,
      text,
      metadata: { source: doc.id, chunkText: text, ...meta }
    }));
  });
  console.log(`Total chunks: ${chunks.length}`);

  // Embed
  const vectors = [];
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    console.log(`Embedding batch ${i/100+1}/${Math.ceil(chunks.length/100)}`);
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

  // Upsert
  for (let i = 0; i < vectors.length; i += 100) {
    const slice = vectors.slice(i, i + 100);
    console.log(`Upserting vectors ${i}-${i + slice.length - 1}…`);
    await index.upsert(slice);
  }
  console.log("✅ All vectors upserted!");
}

main().catch(err => {
  console.error("❌ Indexing error:", err);
  process.exit(1);
});
