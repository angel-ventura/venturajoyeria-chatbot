// server.js  — 2025-05-XX
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors    from "cors";
import OpenAI  from "openai";
import pkg     from "@pinecone-database/pinecone";
import { fetchProducts } from "./fetch-shopify.js";

const { Pinecone } = pkg;
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone();
const index    = pinecone.Index(process.env.PINECONE_INDEX, "");

/* -------------------------------------------------- utils */
const normalize = s =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const stop = new Set([
  "de","del","la","las","el","los","para","en","con","y","oro"
]);

function tokenize(q) {
  return normalize(q)
    .split(/\s+/)
    .filter(w => w && !stop.has(w))
    .map(w => w.replace(/s$/, ""));           // strip plural ‘s’
}

/* -------------------------------------------------- preload */
let PRODUCTS = [];
fetchProducts().then(arr => {
  PRODUCTS = arr.map(p => ({
    title:  p.metadata.title,
    handle: p.metadata.handle,
    image:  p.metadata.image,
    price:  p.metadata.price,
    norm:   normalize(p.metadata.title)
  }));
  console.log(`✅ Loaded ${PRODUCTS.length} active products`);
}).catch(console.error);

/* -------------------------------------------------- collections */
const COLLS = [
  ["Cadenas de Oro",               "cadenas-de-oro"],
  ["Gargantillas de Oro",          "gargantillas-de-oro"],
  ["Anillos de Compromiso de Oro", "anillos-de-compromiso-de-oro"],
  ["Anillo Oro Hombre",            "anillo-oro-hombre"],
  ["Anillo Oro Mujer",             "anillo-oro-mujer"],
  ["Aretes de Oro",                "aretes-de-oro"],
  ["Dijes de Oro",                 "dijes-de-oro"],
  ["Pulseras de Oro para Niños",   "pulseras-de-oro-para-ninos"],
  ["Pulseras de Oro",              "pulseras-de-oro"],
  ["Tobilleras de Oro",            "tobilleras-de-oro"]
];

/* -------------------------------------------------- express */
const app = express();
app.use(cors({ origin: "https://venturajoyeria.com" }));
app.use(express.json());

app.post("/chat", async (req, res) => {
  try {
    /* ---------------- incoming msg */
    const userMsg = (req.body.messages ?? []).at(-1)?.content ?? "";
    const tokens  = tokenize(userMsg);                     // ['cadena','monaco']

    /* ---------------- product search: ALL tokens must appear */
    const hits = PRODUCTS.filter(p =>
      tokens.every(t => p.norm.includes(t))
    );

    if (hits.length) {
      const cards = hits.map(p => ({
        title: p.title,
        url:   `https://${process.env.SHOPIFY_SHOP}/products/${p.handle}`,
        image: p.image,
        price: p.price
      }));
      return res.json({
        type:  hits.length === 1 ? "product" : "productList",
        reply: hits.length === 1 ? "Aquí lo encontré:" : "Encontré estas opciones:",
        ...(hits.length === 1 ? { productCard: cards[0] }
                              : { productCards: cards })
      });
    }

    /* ---------------- collection fallback */
    // (match any collection name word in the query)
    const col = COLLS.find(([name]) =>
      tokens.some(t => normalize(name).includes(t))
    );
    if (col) {
      const [label, handle] = col;
      return res.json({
        type: "collection",
        reply: `Visita nuestra colección de ${label}:`,
        collection: {
          title: label,
          url:   `https://venturajoyeria.com/collections/${handle}`
        }
      });
    }

    /* ---------------- RAG fallback */
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [userMsg]
    });
    const vec = emb.data[0].embedding;
    const rag = await index.query({
      vector:          vec,
      topK:            3,
      includeMetadata: true
    });
    const ctx = rag.matches
      .map((m,i) => `Contexto ${i+1}: ${m.metadata.chunkText}`)
      .join("\n\n");

    const enriched = [
      { role: "system", content: "Usa la siguiente información de la tienda:\n\n" + ctx },
      ...req.body.messages
    ];

    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: enriched
    });

    res.json({ type:"text", reply: chat.choices[0].message.content });

  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ type:"text", reply:"Lo siento, ocurrió un error." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Chat server listening on ${PORT}`));
