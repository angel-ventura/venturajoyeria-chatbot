// ==================== fetch-shopify.js ====================
const axios = require('axios');
require('dotenv').config();

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ADMIN_API_KEY = process.env.SHOPIFY_ADMIN_API_KEY;
const SHOPIFY_ADMIN_API_PASSWORD = process.env.SHOPIFY_ADMIN_API_PASSWORD;

const client = axios.create({
  baseURL: `https://${SHOPIFY_ADMIN_API_KEY}:${SHOPIFY_ADMIN_API_PASSWORD}@${SHOPIFY_STORE}/admin/api/2025-01`,
  headers: { 'Content-Type': 'application/json' },
});

async function fetchAllShopify(resource, query = {}) {
  const results = [];
  let pageInfo = null;
  let params = { limit: 250, ...query };

  do {
    if (pageInfo) params.page_info = pageInfo;
    const res = await client.get(`/${resource}.json`, { params });
    const items = res.data[resource];
    results.push(...items);
    const link = res.headers.link;
    const match = link && link.match(/<[^>]*page_info=([^>]*?)>; rel="next"/);
    pageInfo = match ? match[1] : null;
  } while (pageInfo);

  return results;
}

async function fetchShopifyData() {
  const products = await fetchAllShopify('products');
  const pages = await fetchAllShopify('pages');
  const policies = await fetchAllShopify('policies');
  const priceRules = await fetchAllShopify('price_rules');
  return { products, pages, policies, priceRules };
}

module.exports = { fetchShopifyData };
