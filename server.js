// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import pkg from "@pinecone-database/pinecone";

const { Pinecone } = pkg;

// ─── Init clients ─────────────────────────────────────────────────────────────
const app      = express();
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone();                          // uses PINECONE_API_KEY
const index    = pinecone.Index(process.env.PINECONE_INDEX);

app.use(cors({ origin: "https://venturajoyeria.com" }));
app.use(express.json());

// ─── Chat endpoint (RAG) ──────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  try {
    const messages = req.body.messages;
    const userMsg  = messages[messages.length - 1].content;

    // 1) Embed user query
    const qEmb = (await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [userMsg]
    })).data[0].embedding;

    // 2) Retrieve top‑3 chunks
    const query = await index.query({
      vector: qEmb,
      topK: 3,
      namespace: ""          // default namespace
    });

    const contexts = query.matches
      .map((m, i) => `Context ${i+1} (${m.metadata.source}): ${m.metadata.text}`)
      .join("\n\n");

    // 3) Build enriched prompt
    const enriched = [
      { role: "system",
        content: "You are the Ventura Jewelry assistant. Use the following store information when answering:\n\n" + contexts
      },
      ...messages
    ];

    // 4) Get answer
    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: enriched
    });

    res.json({ reply: chat.choices[0].message });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
