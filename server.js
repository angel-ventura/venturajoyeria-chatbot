// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors    from "cors";
import OpenAI  from "openai";
import pkg     from "@pinecone-database/pinecone";
import { v4 as uuidv4 } from "uuid";
import { fetchProducts } from "./fetch-shopify.js";

const SHOP_DOMAIN = process.env.SHOPIFY_SHOP?.includes('.')
  ? process.env.SHOPIFY_SHOP
  : `${process.env.SHOPIFY_SHOP}.myshopify.com`;

// This is an in-memory store for development/demonstration purposes.
// It is not suitable for production environments as it will lose data on server restart and won't scale.
const conversationStore = new Map();

const { Pinecone } = pkg;
const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone();
const index    = pinecone.Index(process.env.PINECONE_INDEX, "");

/* ─────────── helpers ─────────── */
const normalize = s =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const stop = new Set([
  "de","del","la","las","el","los","para","en","con","y","oro","quiero"
]);

const generic = new Set([
  // greetings / fillers
  "hola","buenas","buenos","dias","días","tardes","noches",
  "hey","hello","hi","??","???",
  // generic actions
  "ver","mostrar","ensename","enseñame","enséname",
  // image requests
  "foto","fotos","imagen","imagenes","imágenes",
  // availability
  "tiene","tienen","hay","disponible","disponibles"
]);

const optional = new Set([
  "10k","14k","18k","24k","10kt","14kt","18kt","kt","k",
  "g","gr","gramos","mm","cm","in","inch","pulgada","pulgadas",
  "largo","ancho","peso","talla"
]);

/* Levenshtein ≤2 */
function isClose(a,b){
  if (Math.abs(a.length-b.length) > 2) return false;
  if (a.length > b.length) [a,b] = [b,a];
  let i = 0, edits = 0;
  while (i < a.length && edits <= 2) {
    if (a[i] === b[i]) { i++; continue; }
    edits++;
    if (a.length === b.length) i++;
    b = b.slice(0,i) + b.slice(i+1);
  }
  return edits + (b.length - i) <= 2;
}

const tokenize = q =>
  normalize(q)
    .split(/\s+/)
    .filter(w => w && !stop.has(w))
    .map(w => w.replace(/s$/,""));

/* ───────── preload products ───────── */
let PRODUCTS = [];
fetchProducts().then(list => {
  PRODUCTS = list.map(p => ({
    title:  p.metadata.title,
    handle: p.metadata.handle,
    image:  p.metadata.image,
    price:  p.metadata.price,
    norm:   normalize(p.metadata.title)
  }));
  console.log(`✅ Loaded ${PRODUCTS.length} published products`);
}).catch(console.error);

/* ───────── collections ───────── */
const COLLS = [
  ["Cadenas de Oro","cadenas-de-oro"],
  ["Gargantillas de Oro","gargantillas-de-oro"],
  ["Anillos de Compromiso de Oro","anillos-de-compromiso-de-oro"],
  ["Anillo Oro Hombre","anillo-oro-hombre"],
  ["Anillo Oro Mujer","anillo-oro-mujer"],
  ["Aretes de Oro","aretes-de-oro"],
  ["Dijes de Oro","dijes-de-oro"],
  ["Pulseras de Oro para Niños","pulseras-de-oro-para-ninos"],
  ["Pulseras de Oro","pulseras-de-oro"],
  ["Tobilleras de Oro","tobilleras-de-oro"]
];

/* ───────── express setup ───────── */
const app = express();
app.use(cors({ origin: "https://venturajoyeria.com" }));
app.use(express.json());

const waCard = {
  title: "WhatsApp Ventura Jewelry",
  url:   "https://wa.me/13058902496"
};

app.post("/chat", async (req, res) => {
  try {
    let conversation_id = req.body.conversation_id;
    if (!conversation_id) {
      conversation_id = uuidv4();
      conversationStore.set(conversation_id, []);
    } else if (!conversationStore.has(conversation_id)) {
      conversationStore.set(conversation_id, []);
    }

    const history = conversationStore.get(conversation_id);
    const msgs = req.body.messages ?? [];
    const messagesForAI = [...history, ...msgs];
    const last = msgs.at(-1)?.content ?? "";
    const norm = normalize(last);

    // 0) explicit human/WhatsApp request
    if (/\b(whatsapp|hablar con|vendedora|humano|asesor|representante)\b/.test(norm)) {
      return res.json({
        conversation_id,
        type:       "collection",
        reply:      "Claro, aquí tienes un enlace directo a nuestro equipo:",
        collection: waCard
      });
    }

    // 1) build search tokens
    let tokens = tokenize(last);
    let search = tokens.filter(t => !generic.has(t) && !optional.has(t));

    // if no tokens, walk back to last valid user query
    if (search.length === 0) {
      for (let i = msgs.length - 2; i >= 0; i--) {
        if (msgs[i].role === "user") {
          const prev = tokenize(msgs[i].content)
            .filter(t => !generic.has(t) && !optional.has(t));
          if (prev.length) { search = prev; break; }
        }
      }
    }

    const askAll = /\b(todas?)\b/.test(norm);

    // 2) product cards
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
          url:   `https://${SHOP_DOMAIN}/products/${p.handle}`,
          image: p.image,
          price: p.price
        }));
        const responsePayload = hits.length === 1
            ? { type: "product",     reply: "Aquí lo encontré:",        productCard: cards[0] }
            : { type: "productList", reply: "Encontré estas opciones:", productCards: cards };
        return res.json({ conversation_id, ...responsePayload });
      }
    }

    // 3) collection link
    if (askAll) {
      const col = COLLS.find(([name]) =>
        tokens.some(t => normalize(name).includes(t))
      );
      if (col) {
        const [label, handle] = col;
        return res.json({
          conversation_id,
          type:       "collection",
          reply:      `Visita nuestra colección de ${label}:`,
          collection: { title: label, url: `https://venturajoyeria.com/collections/${handle}` }
        });
      }
    }

    // 4) RAG fallback → GPT answer + WhatsApp card
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [last] // Using last user message for embedding
    });
    const vec = emb.data[0].embedding;
    const rag = await index.query({ vector: vec, topK: 3, includeMetadata: true });
    const ctx = rag.matches
      .map((m, i) => `Contexto ${i+1}: ${m.metadata.chunkText}`)
      .join("\n\n");

    const systemPrompt = "Eres un amigable y útil asistente de compras para Ventura Joyeria. Usa la información de contexto de la tienda (si se proporciona) y el historial de conversación previo para entender las necesidades y preferencias del cliente. Ofrece recomendaciones personalizadas, recuerda productos mencionados anteriormente si es relevante, y ayuda al cliente a encontrar los artículos perfectos. Contexto de la tienda:\n\n" + (ctx || "No se proporcionó contexto adicional.");
    const systemMessage = { role: "system", content: systemPrompt };
    const messagesForOpenAI = [systemMessage, ...messagesForAI]; // Use combined history for OpenAI

    const chat = await openai.chat.completions.create({
      model:    "gpt-4o-mini",
      messages: messagesForOpenAI
    });

    const aiResponseContent = chat.choices[0].message.content;
    const userMessageForHistory = msgs.at(-1);

    if (userMessageForHistory) {
      history.push({ role: 'user', content: userMessageForHistory.content });
    }
    history.push({ role: 'assistant', content: aiResponseContent });
    conversationStore.set(conversation_id, history);

    return res.json({
      conversation_id,
      type:       "text+collection",
      reply:      aiResponseContent,
      collection: waCard
    });

  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({
      conversation_id: req.body.conversation_id || null, // Attempt to include conversation_id even in error
      type:       "collection",
      reply:      "Lo siento, ocurrió un error. Contáctanos directamente:",
      collection: waCard
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Chat server listening on ${PORT}`));

