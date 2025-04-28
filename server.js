// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import pkg from "@pinecone-database/pinecone";

import { fetchProducts } from "./fetch-shopify.js";

const { Pinecone } = pkg;
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone();
const index    = pinecone.Index(process.env.PINECONE_INDEX, "");

// strip accents & lowercase
const normalize = str =>
  str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const app = express();
app.use(cors({ origin: "https://venturajoyeria.com" }));
app.use(express.json());

// Preload only active products
let productList = [];
fetchProducts()
  .then(list => {
    productList = list.map(p => ({
      title:     p.metadata.title,
      inventory: p.metadata.inventory,
      handle:    p.metadata.handle,
      image:     p.metadata.image,
      normTitle: normalize(p.metadata.title)
    }));
    console.log(`Loaded ${productList.length} active products`);
  })
  .catch(console.error);

app.post("/chat", async (req, res) => {
  try {
    const messages = req.body.messages || [];
    const lastMsg  = messages.at(-1)?.content || "";
    const userNorm = normalize(lastMsg);

    // 1) Exact product title matches
    const exact = productList.filter(p =>
      p.normTitle.includes(userNorm) || userNorm.includes(p.normTitle)
    );
    if (exact.length === 1) {
      const p = exact[0];
      return res.json({
        type: "product",
        reply: `Sí, tenemos ${p.title} en stock: ${p.inventory} unidades.`,
        productCard: {
          title: p.title,
          url:   `https://${process.env.SHOPIFY_SHOP}/products/${p.handle}`,
          image: p.image
        }
      });
    } else if (exact.length > 1) {
      const cards = exact.map(p => ({
        title:     p.title,
        url:       `https://${process.env.SHOPIFY_SHOP}/products/${p.handle}`,
        image:     p.image,
        inventory: p.inventory
      }));
      return res.json({
        type:         "productList",
        reply:        `Encontré varias coincidencias para “${lastMsg}”:`,
        productCards: cards
      });
    }

    // 2) Category fallback -> products
    const categories = [
      { regex: /\baretes?\b/,    term: "arete"    },
      { regex: /\bcadenas?\b/,   term: "cadena"   },
      { regex: /\bcolgantes?\b/, term: "colgante" },
      { regex: /\bpulseras?\b/,  term: "pulsera"  },
      { regex: /\btobilleras?\b/,term: "tobillera"},
      { regex: /\bcollares?\b/,  term: "collar"   }
    ];
    const cat = categories.find(c => c.regex.test(userNorm));
    if (cat) {
      const list = productList.filter(p => p.normTitle.includes(cat.term));
      if (list.length) {
        const cards = list.slice(0,5).map(p => ({
          title:     p.title,
          url:       `https://${process.env.SHOPIFY_SHOP}/products/${p.handle}`,
          image:     p.image,
          inventory: p.inventory
        }));
        return res.json({
          type:         "productList",
          reply:        `Aquí algunas ${cat.term}s:`,
          productCards: cards
        });
      }
      // 2b) No matching active products → point to collection
      return res.json({
        type: "collection",
        reply: `Visita nuestra colección de ${cat.term}s:`,
        collection: {
          title: `Cadenas`,  // adjust per cat.term if desired
          url:   `https://venturajoyeria.com/collections/cadenas`,
          image: null       // or provide a generic collection image URL
        }
      });
    }

    // 3) RAG fallback
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [lastMsg]
    });
    const qEmb = emb.data[0].embedding;
    const qry = await index.query({
      vector:          qEmb,
      topK:            3,
      includeMetadata: true
    });
    const contexts = qry.matches
      .map((m,i) => `Contexto ${i+1} (${m.metadata.source}): ${m.metadata.chunkText}`)
      .join("\n\n");
    const enriched = [
      { role: "system", content: "Usa esta info:\n\n" + contexts },
      ...messages
    ];
    const chat = await openai.chat.completions.create({
      model:    "gpt-4o-mini",
      messages: enriched
    });
    res.json({ type: "text", reply: chat.choices[0].message.content });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ type:"text", reply:"Lo siento, ocurrió un error." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
