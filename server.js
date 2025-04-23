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

// Initialize OpenAI & Pinecone clients
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone();
const index    = pinecone.Index(process.env.PINECONE_INDEX, "");

const app = express();
app.use(cors({ origin: "https://venturajoyeria.com" }));
app.use(express.json());

// Utility: strip accents & lowercase
const normalize = str =>
  str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

// Load full product list at startup for live‐inventory fallback
let productList = [];
fetchProducts()
  .then(list => {
    // Precompute normalized titles
    productList = list.map(p => ({
      ...p,
      metadata: {
        ...p.metadata,
        normTitle: normalize(p.metadata.title)
      }
    }));
    console.log(`Loaded ${productList.length} products for live inventory.`);
  })
  .catch(err => console.error("Error loading products:", err));

app.post("/chat", async (req, res) => {
  try {
    const messages = req.body.messages;
    const userMsg  = messages.at(-1).content;
    const userNorm = normalize(userMsg);

    // 1) Live-stock fallback for “en stock” queries
    if (/tienen?|hay.*en stock/.test(userNorm)) {
      const found = productList.find(p =>
        userNorm.includes(p.metadata.normTitle)
      );
      if (found) {
        return res.json({
          reply: `Sí, tenemos ${found.metadata.title} en stock: ${found.metadata.inventory} unidades disponibles.`
        });
      }
    }

    // 2) RAG flow: embed user query
    const embRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [userMsg]
    });
    const qEmb = embRes.data[0].embedding;

    // 3) Retrieve top-3 from Pinecone
    const queryRes = await index.query({
      vector:          qEmb,
      topK:            3,
      includeMetadata: true
    });

    // 4) Build context from chunkText
    const contexts = queryRes.matches
      .map((m, i) => `Contexto ${i+1} (${m.metadata.source}): ${m.metadata.chunkText}`)
      .join("\n\n");

    // 5) Prepend system prompt
    const enriched = [
      {
        role: "system",
        content: "Usa esta información de la tienda:\n\n" + contexts
      },
      ...messages
    ];

    // 6) Get completion
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
