// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import pkg from "@pinecone-database/pinecone";

const { Pinecone } = pkg;

const app = express();
app.use(cors({ origin: "https://venturajoyeria.com" }));
app.use(express.json());

// ─── Initialize clients ───────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const pinecone = new Pinecone();  // reads PINECONE_API_KEY from env
// If you upserted into the default (empty) namespace, use ""
// If you used a custom namespace like "store-content", put that instead
const index = pinecone.Index(process.env.PINECONE_INDEX, "");

// ─── Chat endpoint (RAG-enabled) ─────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  try {
    const messages = req.body.messages;
    const userMsg  = messages[messages.length - 1].content;

    // 1) Embed the user’s query
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [userMsg],
    });
    const queryVector = embeddingResponse.data[0].embedding;

    // 2) Retrieve top-3 relevant chunks
    const queryResponse = await index.query({
      vector:          queryVector,
      topK:            3,
      includeMetadata: true,
    });

    // 3) Build context string
    const contexts = queryResponse.matches
      .map((m, i) => `Context ${i+1} (${m.metadata.source}): ${m.metadata.text}`)
      .join("\n\n");

    // 4) Prepend as system prompt
    const enriched = [
      {
        role: "system",
        content:
          "You are the Ventura Jewelry assistant. Use the following store information when answering:\n\n" +
          contexts,
      },
      ...messages,
    ];

    // 5) Get completion from OpenAI
    const chatResponse = await openai.chat.completions.create({
      model:    "gpt-4o-mini",
      messages: enriched,
    });

    res.json({ reply: chatResponse.choices[0].message });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
