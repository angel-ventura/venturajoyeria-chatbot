// ==================== index-docs.js ====================
require('dotenv').config();
const { fetchShopifyData } = require('./fetch-shopify');
const { fetchPublicPages } = require('./fetch-public-pages');
const { chunkText } = require('./chunker');
const { PineconeClient } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');

(async () => {
  // initialize OpenAI & Pinecone clients
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const pinecone = new PineconeClient();
  await pinecone.init({
    apiKey: process.env.PINECONE_API_KEY,
    environment: process.env.PINECONE_ENVIRONMENT,
  });
  const index = pinecone.Index(process.env.PINECONE_INDEX);

  // fetch your Shopify + public docs
  const { products, pages, policies, priceRules } = await fetchShopifyData();
  const publicUrls = [process.env.SITE_URL, `${process.env.SITE_URL}/pages/sobre-nosotros`];
  const publicPages = await fetchPublicPages(publicUrls);

  // prepare metadata + text for embedding
  const docs = [
    ...products.map(p => ({
      id: `product-${p.id}`,
      text: p.body_html || p.title,
      metadata: { source: 'shopify-product', handle: p.handle },
    })),
    ...pages.map(p => ({
      id: `page-${p.id}`,
      text: p.body_html || p.title,
      metadata: { source: 'shopify-page', handle: p.handle },
    })),
    ...policies.map(p => ({
      id: `policy-${p.id}`,
      text: p.body_html || p.title,
      metadata: { source: 'shopify-policy', handle: p.handle },
    })),
    ...priceRules.map(r => ({
      id: `discount-${r.id}`,
      text: r.title || r.value,
      metadata: { source: 'shopify-discount', rule: r.id },
    })),
    ...publicPages.map(pp => ({
      id: `public-${Buffer.from(pp.url).toString('base64')}`,
      text: pp.content,
      metadata: { source: 'public', url: pp.url },
    })),
  ];

  // batch upsert into Pinecone
  const batchSize = 100;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    const vectors = [];

    for (const doc of batch) {
      const chunks = chunkText(doc.text, 800, 100);
      for (let idx = 0; idx < chunks.length; idx++) {
        const { embedding } = await openai.embeddings.create({
          model: 'text-embedding-ada-002',
          input: chunks[idx],
        }).then(r => r.data[0]);
        vectors.push({
          id: `${doc.id}-chunk-${idx}`,
          values: embedding,
          metadata: { ...doc.metadata, chunkIndex: idx },
        });
      }
    }

    await index.upsert({ upsertRequest: { vectors } });
    console.log(`Upserted batch ${i/batchSize + 1}/${Math.ceil(docs.length/batchSize)}`);
  }

  console.log('Indexing complete.');
})();
