// index-docs.js
import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import pkg from "@pinecone-database/pinecone";
import { fetchProducts, fetchPages } from "./fetch-shopify.js";
import { fetchPageText } from "./fetch-public-pages.js";
import { chunkText } from "./chunker.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new pkg.Pinecone();
const index = pinecone.Index(process.env.PINECONE_INDEX);

async function main() {
  console.log("Fetching Shopify products…");
  const products = await fetchProducts();
  console.log("→ products:", products.length);

  console.log("Fetching Shopify pages…");
  const pages = await fetchPages();
  console.log("→ pages:", pages.length);

  console.log("Fetching public pages…");
  const urls = [
    "https://venturajoyeria.com/",
    "https://venturajoyeria.com/pages/sobre-nosotros",
    "https://venturajoyeria.com/policies/shipping-policy",
    "https://venturajoyeria.com/policies/refund-policy"
  ];

  const publics = [];
  for (const url of urls) {
    const { text } = await fetchPageText(url);
    console.log(`→ ${url} : ${text.length} chars`);
    publics.push({ id: `public:${url}`, text });
  }
  console.log("→ public pages:", publics.length);

  const allDocs = [
    ...products.map(p => ({ ...p, namespace: "products" })),
    ...pages.map(p => ({ ...p, namespace: "site-info" })),
    ...publics.map(p => ({ ...p, namespace: "site-info" }))
  ];

  console.log("Total raw documents:", allDocs.length);

  const chunks = allDocs.flatMap(doc =>
    chunkText(doc.text).map((piece, i) => ({
      id: `${doc.id}#${i}`,
      values: piece,
      metadata: {
        source: doc.id,
        chunkText: piece
      },
      namespace: doc.namespace
    }))
  );

  console.log("Total chunks:", chunks.length);

  console.log("Embedding chunks...");
  const vectors = [];
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    console.log(`Embedding batch ${i / 100 + 1}/${Math.ceil(chunks.length / 100)}`);
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch.map(c => c.values)
    });

    response.data.forEach((embed, j) => {
      vectors.push({
        id: batch[j].id,
        values: embed.embedding,
        metadata: batch[j].metadata,
        namespace: batch[j].namespace
      });
    });
  }

  console.log("Total vectors to upsert:", vectors.length);

  // Delete only old products (keep site-info)
  console.log("🧹 Deleting old product vectors...");
  await index._deleteAll({ namespace: "products" });

  // Upsert all
  console.log("⬆️ Upserting to Pinecone...");
  const grouped = vectors.reduce((acc, v) => {
    acc[v.namespace] = acc[v.namespace] || [];
    acc[v.namespace].push({
      id: v.id,
      values: v.values,
      metadata: v.metadata
    });
    return acc;
  }, {});

  for (const ns of Object.keys(grouped)) {
    await index.upsert({
      namespace: ns,
      vectors: grouped[ns]
    });
  }

  console.log("✅ Indexing complete!");
}

main().catch(err => {
  console.error("❌ Error indexing docs:", err);
  process.exit(1);
});
