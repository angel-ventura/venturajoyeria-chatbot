// server.js
import dotenv from "dotenv";
dotenv.config();

import fs      from "fs";
import express from "express";
import cors    from "cors";
import OpenAI  from "openai";
import pkg     from "@pinecone-database/pinecone";
import { fetchProducts } from "./fetch-shopify.js";

const { Pinecone } = pkg;
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone();
const index    = pinecone.Index(process.env.PINECONE_INDEX, "");

// ───── load your strong‐prompt guidelines ─────
const GUIDELINES = fs.readFileSync("./guidelines.txt", "utf8").trim() + "\n\n";

// ───── helpers ─────
const normalize = s =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const stop = new Set([
  "de","del","la","las","el","los","para","en","con","y","oro","quiero"
]);

const generic = new Set([
  "hola","buenas","buenos","dias","días","tardes","noches",
  "hey","hello","hi","??","???",
  "ver","mostrar","ensename","enseñame","enséname",
  "foto","fotos","imagen","imagenes","imágenes",
  "tiene","tienen","hay","disponible","disponibles"
]);

const optional = new Set([
  "10k","14k","18k","24k","10kt","14kt","18kt","kt","k",
  "g","gr","gramos","mm","cm","in","inch","pulgada","pulgadas",
  "largo","ancho","peso","talla"
]);

function isClose(a,b){
  if (Math.abs(a.length-b.length) > 2) return false;
  if (a.length > b.length) [a,b] = [b,a];
  let i = 0, edits = 0;
  while (i < a.length && edits <= 2) {
    if (a[i] === b[i]) { i++; continue; }
    edits++;
    if (a.length === b.length) i++;
    b = b.slice(0,i) + b.slice(i+1);
  }
  return edits + (b.length - i) <= 2;
}

const tokenize = q =>
  normalize(q)
    .split(/\s+/)
    .filter(w => w && !stop.has(w))
    .map(w => w.replace(/s$/,""));

// ───── preload products ─────
let PRODUCTS = [];
fetchProducts()
  .then(list => {
    PRODUCTS = list.map(p => ({
      title:  p.metadata.title,
      handle: p.metadata.handle,
      image:  p.metadata.image,
      price:  p.metadata.price,
      norm:   normalize(p.metadata.title)
    }));
    console.log(`✅ Loaded ${PRODUCTS.length} published products`);
  })
  .catch(err => console.error("Error loading products:", err));

// ───── collections ─────
const COLLS = [
  ["Cadenas de Oro","cadenas-de-oro"],
  ["Gargantillas de Oro","gargantillas-de-oro"],
  ["Anillos de Compromiso de Oro","anillos-de-compromiso-de-oro"],
  ["Anillo Oro Hombre","anillo-oro-hombre"],
  ["Anillo Oro Mujer","anillo-oro-mujer"],
  ["Aretes de Oro","aretes-de-oro"],
  ["Dijes de Oro","dijes-de-oro"],
  ["Pulseras de Oro para Niños","pulseras-de-oro-para-ninos"],
  ["Pulseras de Oro","pulseras-de-oro"],
  ["Tobilleras de Oro","tobilleras-de-oro"]
];

// ───── express setup ─────
const app = express();
app.use(cors({ origin: "https://venturajoyeria.com" }));
app.use(express.json());

const waCard = {
  title: "Chatea con nosotros por WhatsApp",
  url:   "https://wa.me/13058902496"
};

app.post("/chat", async (req, res) => {
  try {
    const msgs = req.body.messages ?? [];
    const last = msgs.at(-1)?.content ?? "";
    const norm = normalize(last);

    // 0) “hablar con” → WhatsApp link
    if (/\b(whatsapp|hablar con|vendedora|humano|asesor|representante)\b/.test(norm)) {
      return res.json({
        type:       "collection",
        reply:      "Claro, aquí tienes un enlace directo a nuestro equipo:",
        collection: waCard
      });
    }

    // 1) build meaningful tokens
    let tokens = tokenize(last);
    let search = tokens.filter(t => !generic.has(t) && !optional.has(t));
    if (!search.length) {
      for (let i = msgs.length-2; i >= 0; i--) {
        if (msgs[i].role === "user") {
          const prev = tokenize(msgs[i].content)
            .filter(t => !generic.has(t) && !optional.has(t));
          if (prev.length) { search = prev; break; }
        }
      }
    }

    const askAll = /\b(todas?)\b/.test(norm);

    // 2) product cards by title
    if (search.length) {
      const hits = PRODUCTS.filter(p =>
        search.every(t =>
          p.norm.includes(t) ||
          p.norm.split(/\s+/).some(w => isClose(t, w))
        )
      );
      if (hits.length) {
        const cards = hits.map(p => ({
          title: p.title,
          url:   `https://${process.env.SHOPIFY_SHOP}/products/${p.handle}`,
          image: p.image,
          price: p.price
        }));
        return res.json(
          hits.length === 1
            ? { type: "product",     reply: "Aquí lo encontré:",        productCard: cards[0] }
            : { type: "productList", reply: "Encontré estas opciones:", productCards: cards }
        );
      }
    }

    // 3) “todas” → collection link
    if (askAll) {
      const col = COLLS.find(([name]) =>
        tokens.some(t => normalize(name).includes(t))
      );
      if (col) {
        const [label, handle] = col;
        return res.json({
          type:       "collection",
          reply:      `Visita nuestra colección de ${label}:`,
          collection: { title: label, url: `https://venturajoyeria.com/collections/${handle}` }
        });
      }
    }

    // 4) RAG + GPT fallback
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [last]
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
      // 1) your static guidelines
      { role: "system", content: GUIDELINES },

      // 2) the dynamic RAG contexts
      { role: "system", content: "Contextos de la tienda:\n\n" + ctx },

      // 3) the conversation history
      ...msgs
    ];

    const chat = await openai.chat.completions.create({
      model:    "gpt-4o-mini",
      messages: enriched
    });

    // always include WhatsApp fallback link as part of type
    return res.json({
      type:       "text+collection",
      reply:      chat.choices[0].message.content,
      collection: waCard
    });

  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({
      type:       "collection",
      reply:      "Lo siento, ocurrió un error. Contáctanos:",
      collection: waCard
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Chat server listening on ${PORT}`));
