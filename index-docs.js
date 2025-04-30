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
const index = pinecone.Index(process.env.PINECONE_INDEX);

async function main() {
  // FETCH products
  console.log("Fetching Shopify products…");
  const productsRaw = await fetchProducts();
  console.log("→ products:", productsRaw.length);

  // DELETE old product vectors from namespace "products"
  await index._deleteMany({ deleteAll: true, namespace: "products" });

  // FETCH pages (e.g. shipping policy)
  console.log("Fetching Shopify pages…");
  const pagesRaw = await fetchPages();
  console.log("→ pages:", pagesRaw.length);

  // FETCH public website content
  console.log("Fetching public pages…");
  const siteUrls = [
    "https://venturajoyeria.com/",
    "https://venturajoyeria.com/pages/sobre-nosotros",
    "https://venturajoyeria.com/policies/shipping-policy",
    "https://venturajoyeria.com/policies/refund-policy",
  ];

  const siteRaw = await Promise.all(
    siteUrls.map(async url => {
      const { text } = await fetchPageText(url);
      console.log(`→ ${url} : ${text.length} chars`);
      return { id: `site:${url}`, text };
    })
  );
  console.log("→ public pages:", siteRaw.length);

  // COMBINE all docs
  const allDocs = [
    ...productsRaw.map(p => ({ ...p, namespace: "products" })),
    ...pagesRaw.map(p => ({ ...p, namespace: "site-info" })),
    ...siteRaw.map(p => ({ ...p, namespace: "site-info" })),
  ];
  console.log("Total raw documents:", allDocs.length);

  // CHUNK
  const chunks = allDocs.flatMap(doc =>
    chunkText(doc.text).map((piece, i) => ({
      id: `${doc.id}#${i}`,
      text: piece,
      metadata: { source: doc.id, chunkText: piece },
      namespace: doc.namespace,
    }))
  );
  console.log("Total chunks:", chunks.length);

  // EMBEDDINGS
  const vectors = [];
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    console.log(`Embedding batch ${i / 100 + 1}/${Math.ceil(chunks.length / 100)}`);
    const resp = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch.map(c => c.text),
    });
    resp.data.forEach((e, idx) => {
      vectors.push({
        id: batch[idx].id,
        values: e.embedding,
        metadata: batch[idx].metadata,
        namespace: batch[idx].namespace,
      });
    });
  }
  console.log("Total vectors to upsert:", vectors.length);

  // UPSERT
  console.log("Upserting to Pinecone…");
  await index.upsert({ vectors });
  console.log("✅ All vectors upserted!");
}

main().catch(err => {
  console.error("❌ Error indexing docs:", err);
  process.exit(1);
});
