// index-docs.js
import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import pkg    from "@pinecone-database/pinecone";

import {
  fetchProducts,
  fetchPages,
  fetchShippingPolicy,
  fetchDiscountCodes
} from "./fetch-shopify.js";
import { fetchPageText }  from "./fetch-public-pages.js";
import { fetchPdfChunks } from "./fetch-pdf.js";
import { chunkText }      from "./chunker.js";

const { Pinecone } = pkg;
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone();
const index    = pinecone.Index(process.env.PINECONE_INDEX, "");

async function main() {
  console.log("1️⃣ Shopify products…");
  const products = await fetchProducts(); console.log(`   → ${products.length}`);
  console.log("2️⃣ Shopify pages…");
  const pages    = await fetchPages();    console.log(`   → ${pages.length}`);
  console.log("3️⃣ Shipping policy…");
  const shipping = await fetchShippingPolicy(); console.log(`   → ${shipping.length}`);
  console.log("4️⃣ Discount codes…");
  const discounts = await fetchDiscountCodes();  console.log(`   → ${discounts.length}`);
  console.log("5️⃣ Public pages…");
  const publicUrls = [
    "https://venturajoyeria.com/",
    "https://venturajoyeria.com/pages/sobre-nosotros",
    "https://venturajoyeria.com/policies/shipping-policy",
    "https://venturajoyeria.com/policies/refund-policy"
  ];
  const publics = await Promise.all(publicUrls.map(fetchPageText));
  console.log(`   → ${publics.length}`);
  console.log("6️⃣ Instruction PDF…");
  const pdfChunks = await fetchPdfChunks("instructions.pdf", "instr");
  console.log(`   → ${pdfChunks.length}`);

  const allDocs = [
    ...products,
    ...pages,
    ...shipping,
    ...discounts,
    ...publics.map(d=>({ id:`public:${d.url}`, text:d.text })),
    ...pdfChunks
  ];
  console.log(`📦 Total docs: ${allDocs.length}`);

  const chunks = allDocs.flatMap(doc =>
    chunkText(doc.text).map((t,i)=>({
      id:       `${doc.id}#${i}`,
      text:     t,
      metadata: { source: doc.id }
    }))
  );
  console.log(`✂️ Total chunks: ${chunks.length}`);

  const vectors = [];
  for (let i=0; i<chunks.length; i+=100) {
    console.log(`🔢 Embedding batch ${i/100+1}/${Math.ceil(chunks.length/100)}`);
    const batch = chunks.slice(i,i+100);
    const resp  = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch.map(c=>c.text)
    });
    resp.data.forEach((e,idx)=>{
      vectors.push({
        id:       batch[idx].id,
        values:   e.embedding,
        metadata: batch[idx].metadata
      });
    });
  }
  console.log(`📈 Prepared ${vectors.length} vectors`);

  for (let i=0; i<vectors.length; i+=100) {
    console.log(`⬆️ Upserting ${i}-${i+99}`);
    await index.upsert(vectors.slice(i,i+100));
  }
  console.log("✅ All vectors upserted!");
}

main().catch(err=>{
  console.error("❌ Indexing failed:", err);
  process.exit(1);
});
