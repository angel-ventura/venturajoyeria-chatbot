// index-docs.js — updated for dual namespace syncing
import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import pkg from "@pinecone-database/pinecone";
import { fetchProducts, fetchPages } from "./fetch-shopify.js";
import { fetchPageText } from "./fetch-public-pages.js";
import { chunkText } from "./chunker.js";

const { Pinecone } = pkg;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone();
const index = pinecone.Index(process.env.PINECONE_INDEX);

async function main() {
  // FETCH
  console.log("Fetching Shopify products…");
  const products = await fetchProducts();
  console.log("→ products:", products.length);

  console.log("Fetching Shopify pages…");
  const shopifyPages = await fetchPages();
  console.log("→ pages:", shopifyPages.length);

  console.log("Fetching public pages…");
  const publicPages = await Promise.all([
    "https://venturajoyeria.com/",
    "https://venturajoyeria.com/pages/sobre-nosotros",
    "https://venturajoyeria.com/policies/shipping-policy",
    "https://venturajoyeria.com/policies/refund-policy"
  ].map(async url => {
    const { text } = await fetchPageText(url);
    return { id: `public:${url}`, text };
  }));
  console.log("→ public pages:", publicPages.length);

  const allDocs = [...shopifyPages, ...publicPages];
  console.log("Total pages for site-info:", allDocs.length);

  // 🔁 Clear previous product vectors (but not site-info)
  console.log("🧹 Deleting old 'products' namespace…");
  await index.delete1({ namespace: "products", deleteAll: true });

  // CHUNKING
  const chunkDocs = (docs, ns) => docs.flatMap(doc =>
    chunkText(doc.text).map((piece, i) => ({
      id: `${doc.id}#${i}`,
      values: null, // placeholder, added after embedding
      metadata: { chunkText: piece, source: doc.id },
      namespace: ns
    }))
  );

  const productChunks = chunkDocs(products, "products");
  const infoChunks = chunkDocs(allDocs, "site-info");
  const chunks = [...productChunks, ...infoChunks];
  console.log("Total chunks:", chunks.length);

  // EMBEDDING
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    console.log(`Embedding batch ${i / 100 + 1}/${Math.ceil(chunks.length / 100)}`);
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch.map(c => c.metadata.chunkText)
    });
    response.data.forEach((e, j) => {
      batch[j].values = e.embedding;
    });

    const grouped = batch.reduce((map, vec) => {
      if (!map[vec.namespace]) map[vec.namespace] = [];
      map[vec.namespace].push({
        id: vec.id,
        values: vec.values,
        metadata: vec.metadata
      });
      return map;
    }, {});

    for (const ns in grouped) {
      await index.upsert({
        upsertRequest: {
          vectors: grouped[ns],
          namespace: ns
        }
      });
      console.log(`✅ Uploaded batch to '${ns}'`);
    }
  }

  console.log("🎉 All vectors synced to Pinecone.");
}

main().catch(err => {
  console.error("❌ Error indexing:", err);
  process.exit(1);
});
