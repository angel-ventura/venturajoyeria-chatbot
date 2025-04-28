// fetch-shopify.js
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const SHOP  = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

/**
 * Fetch *all* products + variants via cursor-based pagination.
 * Returns an array of { id, text, metadata:{ title, inventory, handle, image } }.
 */
export async function fetchProducts() {
  let allItems = [];
  let url = `https://${SHOP}/admin/api/2025-01/products.json?limit=250&fields=id,title,handle,body_html,variants,images`;

  while (url) {
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": TOKEN }
    });
    if (!res.ok) {
      throw new Error(`Shopify fetchProducts ${res.status}: ${await res.text()}`);
    }
    const { products = [] } = await res.json();
    allItems = allItems.concat(products);

    const link = res.headers.get("link");
    if (link && link.includes('rel="next"')) {
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      url = match ? match[1] : null;
    } else {
      url = null;
    }
  }

  return allItems.map(p => {
    const title     = p.title || "Sin título";
    const desc      = (p.body_html || "").replace(/<[^>]+>/g, "").trim();
    const inventory = Array.isArray(p.variants) ? 
      p.variants.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0) : 0;
    const handle    = p.handle || "";
    const image     = Array.isArray(p.images) && p.images[0]?.src ? p.images[0].src : "";

    return {
      id:   `product:${p.id}`,
      text: `${title}\n\n${desc}`,
      metadata: { title, inventory, handle, image }
    };
  });
}

/**
 * Fetch your "Sobre Nosotros" page.
 */
export async function fetchPages() {
  const url = `https://${SHOP}/admin/api/2025-01/pages.json?limit=50`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": TOKEN } });
  const { pages = [] } = await res.json();

  const wanted = ["Sobre Nosotros"];
  return pages
    .filter(p => p.title && wanted.includes(p.title))
    .map(p => ({
      id:   `page:${p.id}`,
      text: `${p.title}\n\n${(p.body_html || "").replace(/<[^>]+>/g, "")}`
    }));
}

/**
 * Fetch Shipping Policy.
 */
export async function fetchShippingPolicy() {
  const url = `https://${SHOP}/admin/api/2025-01/policies.json`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": TOKEN } });
  const { policies = [] } = await res.json();
  const shipping = policies.find(p => p.title && /shipping/i.test(p.title));
  if (!shipping) return [];
  return [{ id: "policy:shipping", text: `${shipping.title}\n\n${shipping.body || ""}` }];
}

/**
 * Fetch active Discount Codes.
 */
export async function fetchDiscountCodes() {
  const prUrl = `https://${SHOP}/admin/api/2025-01/price_rules.json?limit=250`;
  const prRes = await fetch(prUrl, { headers: { "X-Shopify-Access-Token": TOKEN } });
  const { price_rules = [] } = await prRes.json();
  const codes = [];
  for (const rule of price_rules) {
    if (!rule.starts_at || (rule.ends_at && new Date(rule.ends_at) < new Date())) continue;
    const dcUrl = `https://${SHOP}/admin/api/2025-01/price_rules/${rule.id}/discount_codes.json`;
    const dcRes = await fetch(dcUrl, { headers: { "X-Shopify-Access-Token": TOKEN } });
    const { discount_codes = [] } = await dcRes.json();
    discount_codes.forEach(code => {
      if (code.code) {
        codes.push({ id: `discount:${code.id}`, text: `Code: ${code.code} (${rule.value_type} ${rule.value})` });
      }
    });
  }
  return codes;
}
