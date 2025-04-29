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

// normalize (strip accents + lowercase)
const normalize = s =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// load just title, handle, image, price
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

// WhatsApp fallback link
const waCard = {
  title: "Chatea con nosotros por WhatsApp",
  url:   "https://wa.me/13058902496"
};

const app = express();
app.use(cors({ origin: "https://venturajoyeria.com" }));
app.use(express.json());

app.post("/chat", async (req, res) => {
  try {
    const messages = req.body.messages || [];
    const last = messages.at(-1)?.content || "";
    const userNorm = normalize(last);

    // 1) simple product‐title search → react with cards
    {
      // break on words, strip tiny words
      const tokens = userNorm.split(/\s+/).filter(w => w.length > 2);
      if (tokens.length) {
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
          // single vs list
          if (cards.length === 1) {
            return res.json({
              type: "product",
              reply: "Aquí está lo que encontré:",
              productCard: cards[0]
            });
          } else {
            return res.json({
              type: "productList",
              reply: "Encontré estas opciones:",
              productCards: cards
            });
          }
        }
      }
    }

    // 2) RAG + GPT fallback
    //  └── build system prompt + contexts
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [last]
    });
    const vec = emb.data[0].embedding;
    const queryRes = await index.query({
      vector:          vec,
      topK:            3,
      includeMetadata: true
    });

    const contexts = queryRes.matches
      .map((m,i) => `Contexto ${i+1} (${m.metadata.source}): ${m.metadata.chunkText}`)
      .join("\n\n");

    // 3) assemble chat messages
    const chatMessages = [
      {
        role: "system",
        content: `
Eres un asistente de **Ventura Joyería**, experto en joyería de oro 10k/14k.
Usa la información de la tienda (productos, políticas de envío, financiamiento, RMA, devoluciones, garantías, colecciones) para responder de forma natural y conversacional.
Cuando el usuario pida “ver fotos” o “mostrar productos”, devuelve siempre tarjetas de producto (imagen, título, precio, enlace).
Si no puedes responder con certeza, responde sólo con:
“Lo siento, no encontré eso. Escríbeme por WhatsApp:” y pon el enlace https://wa.me/13058902496
---
` + contexts
      },
      ...messages
    ];

    const chatRes = await openai.chat.completions.create({
      model:    "gpt-4o-mini",
      messages: chatMessages
    });

    // send back whatever GPT returns
    return res.json({ type: "text", reply: chatRes.choices[0].message.content });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      type: "collection",
      reply: "Ups, algo falló. Escríbenos por WhatsApp:",
      collection: waCard
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Listening on ${PORT}`));
