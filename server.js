// ==================== server.js ====================
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const OpenAI = require('openai');
const { PineconeClient } = require('@pinecone-database/pinecone');
const { fetchShopifyData } = require('./fetch-shopify');

const app = express();
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'keyboard cat',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 86_400_000 },
}));

// initialize clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pineconeClient = new PineconeClient();
(async () => {
  await pineconeClient.init({
    apiKey: process.env.PINECONE_API_KEY,
    environment: process.env.PINECONE_ENVIRONMENT,
  });
  app.locals.index = pineconeClient.Index(process.env.PINECONE_INDEX);
})();

// simple in-memory cache
const cache = new Map();

app.post('/chat', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) {
    return res.status(400).json({ error: 'sessionId and message are required' });
  }

  // session history
  if (!req.session.histories) req.session.histories = {};
  if (!req.session.histories[sessionId]) {
    req.session.histories[sessionId] = [
      { role: 'system', content: process.env.SYSTEM_PROMPT || 'You are a friendly assistant for Ventura Jewelry.' }
    ];
  }
  const history = req.session.histories[sessionId];
  history.push({ role: 'user', content: message });

  // quick product lookup
  if (!app.locals.products) {
    const { products } = await fetchShopifyData();
    app.locals.products = products;
  }
  const found = app.locals.products.find(p =>
    message.toLowerCase().includes(p.title.toLowerCase())
  );

  let reply;
  if (found) {
    reply = `¡Claro! Encontré **${found.title}** por \$${found.variants[0].price}. Mira aquí: ${process.env.STORE_URL}/products/${found.handle}`;
  } else {
    // vector lookup
    let contextChunks = cache.get(message);
    if (!contextChunks) {
      const embResp = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: message,
      });
      const vector = embResp.data[0].embedding;
      const queryResp = await app.locals.index.query({
        queryRequest: { vector, topK: 3, includeMetadata: true }
      });
      contextChunks = queryResp.matches.map(m => m.metadata);
      cache.set(message, contextChunks);
      setTimeout(() => cache.delete(message), 60_000);
    }

    const systemContext = `Contexto relevante:\n${contextChunks.map(c => c.chunkText || '').join('\n\n')}`;
    const messages = [...history, { role: 'system', content: systemContext }];

    const chatResp = await openai.chat.completions.create({
      model: process.env.CHAT_MODEL || 'gpt-3.5-turbo',
      messages,
      temperature: 0.7,
      top_p: 0.9,
    });
    reply = chatResp.choices[0].message.content.trim();
  }

  history.push({ role: 'assistant', content: reply });
  res.json({ reply });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
