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

// strip accents + lowercase
const normalize = s =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// words to ignore completely
const stop = new Set([
  "de","del","la","las","el","los","para","en","con","y","oro","quiero"
]);

// generic commands / affirmatives
const generic = new Set([
  "hola","buenas","buenos","dias","días","tardes","noches","hey","hello","hi",
  "ver","mostrar","ensename","enseñame","enséname",
  "foto","fotos","imagen","imagenes","imágenes",
  "tiene","tienen","hay","disponible","disponibles",
  "si","sí"
]);

// qualifiers to ignore
const optional = new Set([
  "10k","14k","18k","24k","10kt","14kt","18kt","kt","k",
  "g","gr","gramos","mm","cm","in","inch","pulgada","pulgadas",
  "largo","ancho","peso","talla"
]);

// fuzzy match up to 2 edits
function isClose(a,b){
  if (Math.abs(a.length-b.length)>2) return false;
  if (a.length>b.length)[a,b]=[b,a];
  let i=0, edits=0;
  while(i<a.length&&edits<=2){
    if(a[i]===b[i]){ i++; continue; }
    edits++;
    if(a.length===b.length) i++;
    b=b.slice(0,i)+b.slice(i+1);
  }
  return edits + (b.length - i) <= 2;
}

// extract meaningful tokens from a user query
const tokenize = q =>
  normalize(q)
    .split(/\s+/)
    .filter(w => w && !stop.has(w) && !generic.has(w) && !optional.has(w))
    .map(w => w.replace(/s$/,""));

// preload product catalog
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
    console.log(`✅ Loaded ${PRODUCTS.length} products`);
  })
  .catch(err => console.error("Error loading products:", err));

// collection mappings
const COLLECTIONS = {
  "nino":  { title: "Cadenas de Oro para Niños", url: "https://venturajoyeria.com/collections/cadenas-de-oro-para-ninos" },
  // already had these:
  "pulseras-para-ninos": { title: "Pulseras de Oro para Niños", url: "https://venturajoyeria.com/collections/pulseras-de-oro-para-ninos" },
  // …add more if you like…
};

// WhatsApp fallback
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
    const last = msgs.at(-1)?.content  || "";
    const norm = normalize(last);

    // 1) explicit human request → WhatsApp
    if (/\b(whatsapp|hablar con|vendedora|humano|representante)\b/.test(norm)) {
      return res.json({
        type: "collection",
        reply: "Claro, te paso nuestro enlace de WhatsApp:",
        collection: waCard
      });
    }

    // 2) build search tokens (ignore “si” etc)
    let tokens = tokenize(last);
    let search = tokens.length
      ? tokens
      : // fallback to previous actual user query
      (() => {
        for (let i = msgs.length-2; i >= 0; i--) {
          if (msgs[i].role === "user") {
            const t = tokenize(msgs[i].content);
            if (t.length) return t;
          }
        }
        return [];
      })();

    const askedAll = /\b(todas?)\b/.test(norm);

    // 3) product‐by‐title search
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
          cards.length === 1
            ? { type:"product",     reply:"Aquí lo encontré:",           productCard: cards[0] }
            : { type:"productList", reply:"Encontré estas opciones:",  productCards: cards }
        );
      }

      // 3b) special “niño(s)” → children chain collection
      if (search.includes("nino") || search.includes("ninos")) {
        const col = COLLECTIONS["nino"];
        return res.json({
          type: "collection",
          reply: "Mira nuestra colección de cadenas para niños:",
          collection: col
        });
      }
    }

    // 4) catch-all “todas” → collection link if mapped
    if (askedAll) {
      // try to map any token to a collection slug
      for (const t of search) {
        if (COLLECTIONS[t]) {
          const col = COLLECTIONS[t];
          return res.json({
            type: "collection",
            reply: `Visita nuestra colección de ${col.title}:`,
            collection: col
          });
        }
      }
    }

    // 5) RAG fallback
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [last]
    });
    const vec = emb.data[0].embedding;
    const rag = await index.query({ vector: vec, topK: 3, includeMetadata: true });

    if (!rag.matches.length) {
      // no context → WhatsApp
      return res.json({
        type: "collection",
        reply: "Lo siento, no encontré eso. Escríbenos por WhatsApp:",
        collection: waCard
      });
    }

    const ctx = rag.matches
      .map((m,i)=>`Contexto ${i+1}: ${m.metadata.chunkText}`)
      .join("\n\n");

    const enriched = [
      { role:"system", content:"Usa esta información de la tienda:\n\n" + ctx },
      ...msgs
    ];
    const chat = await openai.chat.completions.create({
      model:    "gpt-4o-mini",
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
app.listen(PORT, () => console.log(`🚀 Listening on ${PORT}`));
