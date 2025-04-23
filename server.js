// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import pkg from "@pinecone-database/pinecone";

import { fetchProducts } from "./fetch-shopify.js";
import { fetchPageText } from "./fetch-public-pages.js";

const { Pinecone } = pkg;
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone();
const index    = pinecone.Index(process.env.PINECONE_INDEX, "");

const app = express();
app.use(cors({ origin: "https://venturajoyeria.com" }));
app.use(express.json());

const normalize = str =>
  str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Preload products safely
let productList = [];
fetchProducts()
  .then(list => {
    productList = list
      .filter(p => p.metadata && p.metadata.title)
      .map(p => ({
        title:     p.metadata.title,
        inventory: p.metadata.inventory,
        normTitle: normalize(p.metadata.title)
      }));
    console.log(`Loaded ${productList.length} products for inventory.`);
  })
  .catch(err => console.error("Error loading products:", err));

app.post("/chat", async (req, res) => {
  try {
    const messages = req.body.messages || [];
    const lastMsg  = messages.at(-1)?.content || "";
    const userNorm = normalize(lastMsg);

    // Live-stock fallback
    if (/tienen?|hay.*en stock/.test(userNorm)) {
      const found = productList.find(p => userNorm.includes(p.normTitle));
      if (found) {
        return res.json({
          reply: `Sí, tenemos ${found.title} en stock: ${found.inventory} unidades disponibles.`
        });
      }
    }

    // RAG: embed + query
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [lastMsg]
    });
    const qEmb = emb.data[0].embedding;

    const queryRes = await index.query({
      vector:          qEmb,
      topK:            3,
      includeMetadata: true
    });

    const contexts = queryRes.matches
      .map((m, i) => `Contexto ${i+1} (${m.metadata.source}): ${m.metadata.chunkText}`)
      .join("\n\n");

    const enriched = [
      { role: "system", content: "Usa esta información de la tienda:\n\n" + contexts },
      ...messages
    ];

    const chatRes = await openai.chat.completions.create({
      model:    "gpt-4o-mini",
      messages: enriched
    });

    res.json({ reply: chatRes.choices[0].message });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
