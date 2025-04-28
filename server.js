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

// preload active products
let productList = [];
fetchProducts()
  .then(list => {
    productList = list.map(p => ({
      title:  p.metadata.title,
      handle: p.metadata.handle,
      image:  p.metadata.image,
      price:  p.metadata.price,
      norm:   normalize(p.metadata.title)
    }));
    console.log(`Loaded ${productList.length} products`);
  })
  .catch(console.error);

app.post("/chat", async (req, res) => {
  try {
    const messages = req.body.messages || [];
    const last     = messages.at(-1)?.content || "";
    const normLast = normalize(last);

    // 1) Exact title match
    const exact = productList.filter(p =>
      p.norm.includes(normLast) || normLast.includes(p.norm)
    );
    if (exact.length === 1) {
      const p = exact[0];
      return res.json({
        type: "product",
        reply: `Aquí está lo que encontré:`,
        productCard: {
          title: p.title,
          url:   `https://${process.env.SHOPIFY_SHOP}/products/${p.handle}`,
          image: p.image,
          price: p.price
        }
      });
    }
    if (exact.length > 1) {
      const cards = exact.map(p => ({
        title: p.title,
        url:   `https://${process.env.SHOPIFY_SHOP}/products/${p.handle}`,
        image: p.image,
        price: p.price
      }));
      return res.json({
        type:         "productList",
        reply:        `Encontré varias coincidencias:`,
        productCards: cards
      });
    }

    // 2) Category + subcategory (e.g. "cadenas monacos")
    const categories = [
      { regex: /\baretes?\b/,    handle: "aretes-y-argollas" },
      { regex: /\bcadenas?\b/,   handle: "cadenas"           },
      { regex: /\bcolgantes?\b/, handle: "colgantes"         },
      { regex: /\bpulseras?\b/,  handle: "pulseras"          },
      { regex: /\btobilleras?\b/,handle: "tobilleras"        },
      { regex: /\b(collares?)\b/,handle: "collares"          }
    ];
    const cat = categories.find(c => c.regex.test(normLast));
    if (cat) {
      // 2a) If they ask "ver todas" or "todas"
      if (/\btoda(s)?\b|\bver todas?\b/.test(normLast)) {
        return res.json({
          type: "collection",
          reply: `Mira toda nuestra colección:`,
          collection: {
            title: cat.handle.replace(/-/g," ").toUpperCase(),
            url:   `https://venturajoyeria.com/collections/${cat.handle}`,
            image: null
          }
        });
      }
      // 2b) If they specify subterm (e.g. "monacos")
      const leftover = normLast.replace(cat.regex, "").trim();
      if (leftover) {
        const subMatches = productList.filter(p => p.norm.includes(leftover));
        if (subMatches.length) {
          const cards = subMatches.map(p => ({
            title: p.title,
            url:   `https://${process.env.SHOPIFY_SHOP}/products/${p.handle}`,
            image: p.image,
            price: p.price
          }));
          return res.json({
            type:         "productList",
            reply:        `Aquí están nuestras ${leftover}:`,
            productCards: cards
          });
        }
      }
      // 2c) Generic category fallback to some items
      const catMatches = productList.filter(p => p.norm.includes(cat.handle.slice(0,-1)));
      if (catMatches.length) {
        const cards = catMatches.slice(0,5).map(p => ({
          title: p.title,
          url:   `https://${process.env.SHOPIFY_SHOP}/products/${p.handle}`,
          image: p.image,
          price: p.price
        }));
        return res.json({
          type:         "productList",
          reply:        `Algunas ${cat.handle.replace(/-/g," ")} que ofrecemos:`,
          productCards: cards
        });
      }
      // fallback: collection
      return res.json({
        type: "collection",
        reply: `Visita nuestra colección completa:`,
        collection: {
          title: cat.handle.replace(/-/g," ").toUpperCase(),
          url:   `https://venturajoyeria.com/collections/${cat.handle}`,
          image: null
        }
      });
    }

    // 3) RAG fallback
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [last]
    });
    const qEmb = emb.data[0].embedding;
    const queryRes = await index.query({
      vector:          qEmb,
      topK:            3,
      includeMetadata: true
    });
    const contexts = queryRes.matches
      .map((m,i) => `Contexto ${i+1}: ${m.metadata.chunkText}`)
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
