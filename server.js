// ==================== server.js ====================
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Configuration, OpenAIApi } = require('openai');
const pinecone = require('@pinecone-database/pinecone');
const { fetchShopifyData } = require('./fetch-shopify');

const app = express();
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'keyboard cat',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 86400000 }
}));

const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));
const pineconeClient = new pinecone.PineconeClient();
(async () => {
  await pineconeClient.init({ apiKey: process.env.PINECONE_API_KEY, environment: process.env.PINECONE_ENV });
  app.locals.index = pineconeClient.Index(process.env.PINECONE_INDEX);
})();

// simple in-memory cache for search
const cache = new Map();

app.post('/chat', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: 'sessionId and message are required' });

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
  const found = app.locals.products.find(p => message.toLowerCase().includes(p.title.toLowerCase()));
  let reply;
  if (found) {
    reply = `¡Claro! Encontré **${found.title}** por $${found.variants[0].price}. Aquí: ${process.env.STORE_URL}/products/${found.handle}`;
  } else {
    // vector query
    let contextChunks;
    if (cache.has(message)) {
      contextChunks = cache.get(message);
    } else {
      const emb = await openai.createEmbedding({ model: 'text-embedding-ada-002', input: message });
      const query = await app.locals.index.query({ queryRequest: { vector: emb.data.data[0].embedding, topK: 3, includeMetadata: true } });
      contextChunks = query.matches.map(m => m.metadata);
      cache.set(message, contextChunks);
      setTimeout(() => cache.delete(message), 60000);
    }
    const systemContext = `Contexto relevante:\n${contextChunks.map(c => c.chunkText || '').join('\n\n')}`;
    const msgs = [...history, { role: 'system', content: systemContext }];
    const completion = await openai.createChatCompletion({
      model: process.env.CHAT_MODEL || 'gpt-3.5-turbo',
      messages: msgs,
      temperature: 0.7,
      top_p: 0.9
    });
    reply = completion.data.choices[0].message.content.trim();
  }

  history.push({ role: 'assistant', content: reply });
  res.json({ reply });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
