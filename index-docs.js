// index-docs.js
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
const index = pinecone.index(process.env.PINECONE_INDEX);

async function main() {
  // 1. Fetch Products & Pages
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
    "https://venturajoyeria.com/policies/refund-policy",
  ].map(async url => {
    const { text } = await fetchPageText(url);
    return { id: `public:${url}`, text };
  }));
  console.log("→ public pages:", publics.length);

  // 2. Namespace Strategy
  const productDocs = products.map(p => ({ ...p, namespace: "products" }));
  const siteDocs = [...pages, ...publics].map(p => ({ ...p, namespace: "site-info" }));
  const allDocs = [...productDocs, ...siteDocs];
  console.log("Total raw documents:", allDocs.length);

  // 🧹 3. Delete old product vectors (only!)
  console.log("🧹 Deleting old product vectors...");
  await index.namespace("products").deleteAll();
  console.log("✅ Old product vectors deleted.");

  // 4. Chunk
  const chunks = allDocs.flatMap(doc =>
    chunkText(doc.text).map((piece, i) => ({
      id: `${doc.id}#${i}`,
      text: piece,
      metadata: { source: doc.id },
      namespace: doc.namespace
    }))
  );
  console.log("Total chunks:", chunks.length);

  // 5. Embed
  const vectors = [];
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    console.log(`Embedding batch ${i / 100 + 1}/${Math.ceil(chunks.length / 100)}`);
    const resp = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch.map(c => c.text)
    });
    resp.data.forEach((e, idx) => {
      vectors.push({
        id: batch[idx].id,
        values: e.embedding,
        metadata: batch[idx].metadata,
        namespace: batch[idx].namespace
      });
    });
  }
  console.log("Total vectors to upsert:", vectors.length);

  // 6. Upsert to Pinecone
  console.log("Upserting to Pinecone…");
  await index.upsert(vectors);
  console.log("✅ Upsert complete!");
}

main().catch(err => {
  console.error("❌ Error indexing docs:", err);
  process.exit(1);
});
