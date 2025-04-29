// server.js
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

// normalize text: strip accents, to lower
const normalize = str =>
  str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// stop‐words we never want as search terms
const stop = new Set([
  "de","del","la","las","el","los","para","en","con","y","oro","quiero"
]);

// generic standalone words that mean “show me” or “yes” etc.
const generic = new Set([
  "hola","buenas","buenos","dias","días","tardes","noches","hey","hello","hi",
  "ver","mostrar","ensename","enseñame","enséname","foto","fotos","imagen",
  "imagenes","imágenes","tiene","tienen","hay","disponible","disponibles",
  "si","sí"                      // ← added these two
]);

// optional qualifiers (we ignore them when searching)
const optional = new Set([
  "10k","14k","18k","24k","10kt","14kt","18kt","kt","k",
  "g","gr","gramos","mm","cm","in","inch","pulgada","pulgadas",
  "largo","ancho","peso","talla"
]);

// fuzzy match up to 2 typos
function isClose(a,b){
  if (Math.abs(a.length-b.length)>2) return false;
  if (a.length>b.length)[a,b]=[b,a];
  let i=0, edits=0;
  while(i<a.length&&edits<=2){
    if(a[i]===b[i]){i++;continue;}
    edits++;
    if(a.length===b.length) i++;
    b=b.slice(0,i)+b.slice(i+1);
  }
  return edits + (b.length - i) <= 2;
}

// turn a query into keywords, ignoring stop/generic/optional
const tokenize = q =>
  normalize(q)
    .split(/\s+/)
    .filter(w => w && !stop.has(w) && !generic.has(w) && !optional.has(w))
    .map(w => w.replace(/s$/,""));

let PRODUCTS = [];
fetchProducts()
  .then(list => {
    PRODUCTS = list.map(p=>({
      title:  p.metadata.title,
      handle: p.metadata.handle,
      image:  p.metadata.image,
      price:  p.metadata.price,
      norm:   normalize(p.metadata.title)
    }));
    console.log(`✅ Loaded ${PRODUCTS.length} products`);
  })
  .catch(err => console.error("Error loading products:", err));

// collection mapping
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

// WhatsApp fallback card
const waCard = {
  title: "Chatea con nosotros por WhatsApp",
  url:   "https://wa.me/13058902496"
};

const app = express();
app.use(cors({ origin: "https://venturajoyeria.com" }));
app.use(express.json());

app.post("/chat", async (req, res) => {
  try {
    const msgs = req.body.messages || [];
    const last = msgs.at(-1)?.content || "";
    const norm = normalize(last);

    // if they ask explicitly for human/WhatsApp
    if (/\b(whatsapp|hablar con|vendedora|humano|representante)\b/.test(norm)) {
      return res.json({
        type: "collection",
        reply: "Claro, aquí te conectas vía WhatsApp:",
        collection: waCard
      });
    }

    // build search tokens
    let tokens = tokenize(last);
    let search = tokens;

    // if no real tokens (or user just said 'si'), fall back to previous user entry
    if (!search.length) {
      for (let i = msgs.length - 2; i >= 0; i--) {
        if (msgs[i].role === "user") {
          const prev = tokenize(msgs[i].content);
          if (prev.length) {
            search = prev;
            break;
          }
        }
      }
    }

    const askAll = /\b(todas?)\b/.test(norm);

    // 1) PRODUCT SEARCH by title fuzzy & exact
    if (search.length) {
      const hits = PRODUCTS.filter(p =>
        search.every(t =>
          p.norm.includes(t) ||
          p.norm.split(/\s+/).some(w => isClose(t, w))
        )
      );
      if (hits.length) {
        const cards = hits.map(p=>({
          title: p.title,
          url:   `https://${process.env.SHOPIFY_SHOP}/products/${p.handle}`,
          image: p.image,
          price: p.price
        }));
        return res.json(
          cards.length === 1
            ? { type:"product",     reply:"Aquí lo encontré:",     productCard: cards[0] }
            : { type:"productList", reply:"Encontré estas opciones:", productCards: cards }
        );
      }
    }

    // 2) COLLECTION link if they asked for “todas”
    if (askAll) {
      const col = COLLS.find(([name]) =>
        tokens.some(t => normalize(name).includes(t))
      );
      if (col) {
        const [label, handle] = col;
        return res.json({
          type: "collection",
          reply: `Visita toda nuestra colección de ${label}:`,
          collection: { title: label, url: `https://venturajoyeria.com/collections/${handle}` }
        });
      }
    }

    // 3) RAG fallback
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [last]
    });
    const vec = emb.data[0].embedding;
    const rag = await index.query({ vector: vec, topK: 3, includeMetadata: true });

    // if absolutely no context matches, WhatsApp fallback
    if (!rag.matches.length) {
      return res.json({
        type: "collection",
        reply: "Lo siento, no encontré eso. Escríbenos por WhatsApp:",
        collection: waCard
      });
    }

    // otherwise enrich with contexts
    const ctx = rag.matches
      .map((m,i)=>`Contexto ${i+1}: ${m.metadata.chunkText}`)
      .join("\n\n");
    const enriched = [
      { role:"system", content:"Usa esto de la tienda y responde: \n\n" + ctx },
      ...msgs
    ];
    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: enriched
    });
    return res.json({ type:"text", reply: chat.choices[0].message.content });

  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({
      type: "collection",
      reply: "Ups, algo falló. Escríbenos por WhatsApp:",
      collection: waCard
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, ()=> console.log(`🚀 Listening on ${PORT}`));
