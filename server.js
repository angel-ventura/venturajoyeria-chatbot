// server.js  —  deploy this file as-is
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

/* ───────────────────────── helpers ───────────────────────── */
const normalize = s =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const stop = new Set([
  "de","del","la","las","el","los","para","en","con","y",
  "oro","quiero"
]);

const generic = new Set([
  "ver","mostrar","ensename","enseñame","enséname"
]);

const tokenize = q =>
  normalize(q)
    .split(/\s+/)
    .filter(w => w && !stop.has(w))
    .map(w => w.replace(/s$/, ""));           // singularize

/* ───────────────────── preload products ───────────────────── */
let PRODUCTS = [];
fetchProducts().then(list => {
  PRODUCTS = list.map(p => ({
    title:  p.metadata.title,
    handle: p.metadata.handle,
    image:  p.metadata.image,
    price:  p.metadata.price,
    norm:   normalize(p.metadata.title)
  }));
  console.log(`✅ Loaded ${PRODUCTS.length} active products`);
}).catch(console.error);

/* ──────────────────── collections data ───────────────────── */
const COLLS = [
  ["Cadenas de Oro",               "cadenas-de-oro"               ],
  ["Gargantillas de Oro",          "gargantillas-de-oro"          ],
  ["Anillos de Compromiso de Oro", "anillos-de-compromiso-de-oro" ],
  ["Anillo Oro Hombre",            "anillo-oro-hombre"            ],
  ["Anillo Oro Mujer",             "anillo-oro-mujer"             ],
  ["Aretes de Oro",                "aretes-de-oro"                ],
  ["Dijes de Oro",                 "dijes-de-oro"                 ],
  ["Pulseras de Oro para Niños",   "pulseras-de-oro-para-ninos"   ],
  ["Pulseras de Oro",              "pulseras-de-oro"              ],
  ["Tobilleras de Oro",            "tobilleras-de-oro"            ]
];

/* ───────────────────────── express ───────────────────────── */
const app = express();
app.use(cors({ origin: "https://venturajoyeria.com" }));
app.use(express.json());

app.post("/chat", async (req, res) => {
  try {
    const msgs   = req.body.messages ?? [];
    const user   = msgs.at(-1)?.content ?? "";
    const norm   = normalize(user);
    const tokens = tokenize(user);

    const searchTokens = tokens.filter(t => !generic.has(t));  // ignore verbs
    const askAll       = /\btodas?\b/.test(norm);              // only “toda / todas”

    /* ── 1) product-card search (ALL tokens must appear) ── */
    let matches = [];
    if (searchTokens.length) {
      matches = PRODUCTS.filter(p =>
        searchTokens.every(t => p.norm.includes(t))
      );
      if (matches.length) {
        const cards = matches.map(p => ({
          title: p.title,
          url:   `https://${process.env.SHOPIFY_SHOP}/products/${p.handle}`,
          image: p.image,
          price: p.price
        }));
        return res.json(
          matches.length === 1
            ? { type:"product", reply:"Aquí lo encontré:", productCard: cards[0] }
            : { type:"productList", reply:"Encontré estas opciones:", productCards: cards }
        );
      }
    }

    /* ── 2) collection link (only if user asked for “todas…”) ── */
    if (askAll) {
      const col = COLLS.find(([name]) =>
        tokens.some(t => normalize(name).includes(t))
      );
      if (col) {
        const [label, handle] = col;
        return res.json({
          type:"collection",
          reply:`Visita nuestra colección de ${label}:`,
          collection:{ title: label, url:`https://venturajoyeria.com/collections/${handle}` }
        });
      }
    }

    /* ── 3) RAG fallback ── */
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [user]
    });
    const vec = emb.data[0].embedding;
    const rag = await index.query({ vector: vec, topK: 3, includeMetadata: true });
    const ctx = rag.matches
      .map((m,i)=>`Contexto ${i+1}: ${m.metadata.chunkText}`)
      .join("\n\n");

    const enriched = [
      { role:"system", content:"Usa esta información de la tienda:\n\n"+ctx },
      ...msgs
    ];
    const chat = await openai.chat.completions.create({
      model:"gpt-4o-mini",
      messages: enriched
    });

    res.json({ type:"text", reply: chat.choices[0].message.content });

  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ type:"text", reply:"Lo siento, ocurrió un error." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Chat server running on ${PORT}`));
