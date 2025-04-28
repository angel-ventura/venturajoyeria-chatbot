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

// Utility: normalize & strip accents
const normalize = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const app = express();
app.use(cors({ origin: "https://venturajoyeria.com" }));
app.use(express.json());

// Preload products
let productList = [];
fetchProducts().then(list => {
  productList = list;
  console.log(`Loaded ${list.length} products`);
}).catch(err => console.error("Load products error:", err));

app.post("/chat", async (req, res) => {
  try {
    const messages = req.body.messages || [];
    const last     = messages.at(-1)?.content || "";
    const userNorm = normalize(last);

    // Live-stock fallback
    if (/tienen?|hay.*en stock/.test(userNorm)) {
      const found = productList.find(p => normalize(p.metadata.title).includes(userNorm));
      if (found) {
        const url = `https://${process.env.SHOPIFY_SHOP}/products/${found.metadata.handle}`;
        return res.json({
          type: "product",
          reply: `Sí, tenemos ${found.metadata.title} en stock: ${found.metadata.inventory} unidades.`,
          productCard: { title: found.metadata.title, url, image: found.metadata.image }
        });
      }
    }

    // RAG
    const embRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: [last] });
    const qEmb   = embRes.data[0].embedding;
    const query  = await index.query({ vector: qEmb, topK: 3, includeMetadata: true });
    const contexts = query.matches.map((m,i) => `Contexto ${i+1} (${m.metadata.source}): ${m.metadata.chunkText}`)
      .join("\n\n");

    const enriched = [{ role: "system", content: "Usa esta info:\n\n" + contexts }, ...messages];
    const chatRes = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: enriched });
    res.json({ type: "text", reply: chatRes.choices[0].message.content || chatRes.choices[0].message });
  } catch (e) {
    console.error("Chat error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
