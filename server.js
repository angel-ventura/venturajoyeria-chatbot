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

// Preload products
let productList = [];
fetchProducts()
  .then(list => {
    productList = list.map(p => ({
      id:        p.id,
      title:     p.metadata.title,
      inventory: p.metadata.inventory,
      handle:    p.metadata.handle,
      image:     p.metadata.image,
      normTitle: normalize(p.metadata.title)
    }));
    console.log(`Loaded ${productList.length} products`);
  })
  .catch(console.error);

app.post("/chat", async (req, res) => {
  try {
    const messages = req.body.messages || [];
    const lastMsg  = messages.at(-1)?.content || "";
    const userNorm = normalize(lastMsg);

    // 1) Direct title match
    const exactMatches = productList.filter(p =>
      p.normTitle.includes(userNorm) || userNorm.includes(p.normTitle)
    );
    if (exactMatches.length === 1) {
      const p = exactMatches[0];
      return res.json({
        type: "product",
        reply: `Sí, tenemos ${p.title} en stock: ${p.inventory} unidades.`,
        productCard: {
          title: p.title,
          url:   `https://${process.env.SHOPIFY_SHOP}/products/${p.handle}`,
          image: p.image
        }
      });
    }
    if (exactMatches.length > 1) {
      const cards = exactMatches.map(p => ({
        title:     p.title,
        url:       `https://${process.env.SHOPIFY_SHOP}/products/${p.handle}`,
        image:     p.image,
        inventory: p.inventory
      }));
      return res.json({
        type:         "productList",
        reply:        `Encontré varias coincidencias para "${lastMsg}":`,
        productCards: cards
      });
    }

    // 2) Category fallback
    const categories = [
      { regex: /\baretes?\b/,    term: "arete"    },
      { regex: /\bcadenas?\b/,   term: "cadena"   },
      { regex: /\bcollares?\b/,  term: "collar"   },
      { regex: /\bpulseras?\b/,  term: "pulsera"  },
      { regex: /\btobilleras?\b/,term: "tobillera"},
      { regex: /\bcolgantes?\b/, term: "colgante" }
    ];
    let cat = categories.find(c => c.regex.test(userNorm));
    if (cat) {
      const list = productList.filter(p => p.normTitle.includes(cat.term));
      if (list.length) {
        const cards = list.slice(0, 5).map(p => ({
          title:     p.title,
          url:       `https://${process.env.SHOPIFY_SHOP}/products/${p.handle}`,
          image:     p.image,
          inventory: p.inventory
        }));
        return res.json({
          type:         "productList",
          reply:        `Aquí tienes algunas ${cat.term}s que manejamos:`,
          productCards: cards
        });
      }
    }

    // 3) RAG fallback
    const embRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [lastMsg]
    });
    const qEmb = embRes.data[0].embedding;

    const queryRes = await index.query({
      vector:          qEmb,
      topK:            3,
      includeMetadata: true
    });

    const contexts = queryRes.matches
      .map((m,i) => `Contexto ${i+1} (${m.metadata.source}): ${m.metadata.chunkText}`)
      .join("\n\n");

    const enriched = [
      { role: "system", content: "Usa esta info de la tienda:\n\n" + contexts },
      ...messages
    ];

    const chatRes = await openai.chat.completions.create({
      model:    "gpt-4o-mini",
      messages: enriched
    });

    res.json({ type: "text", reply: chatRes.choices[0].message.content });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ type: "text", reply: "Lo siento, ocurrió un error." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
