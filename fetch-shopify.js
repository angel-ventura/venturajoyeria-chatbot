// fetch-shopify.js
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const SHOP  = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

/**
 * Fetch *only* published products + variants via cursor‐based pagination.
 * Returns an array of { id, text, metadata:{ title, inventory, handle, image, price } }.
 */
export async function fetchProducts() {
  let allItems = [];
  // 🔒 Add published_status=published to retrieve only live products
  let url = `https://${SHOP}/admin/api/2025-01/products.json` +
            `?limit=250&published_status=published` +
            `&fields=id,title,body_html,variants,handle,images`;

  while (url) {
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": TOKEN }
    });
    if (!res.ok) {
      throw new Error(`Shopify fetchProducts ${res.status}: ${await res.text()}`);
    }
    const { products = [] } = await res.json();
    allItems = allItems.concat(products);

    // pagination via Link header
    const link = res.headers.get("link");
    if (link && link.includes('rel="next"')) {
      const m = link.match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
    } else {
      url = null;
    }
  }

  return allItems.map(p => {
    const title = p.title || "Sin título";
    const desc  = (p.body_html || "").replace(/<[^>]+>/g, "").trim();
    const inventory = Array.isArray(p.variants)
      ? p.variants.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0)
      : 0;
    // pick the first image and first variant price
    const image = p.images?.[0]?.src || "";
    const price = p.variants?.[0]?.price || "";

    return {
      id:   `product:${p.id}`,
      text: `${title}\n\n${desc}`,
      metadata: {
        title,
        inventory,
        handle: p.handle,
        image,
        price
      }
    };
  });
}

/**
 * Fetch your “Sobre Nosotros” page by title.
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
 * Fetch Shipping Policy via Policies API.
 */
export async function fetchShippingPolicy() {
  const url = `https://${SHOP}/admin/api/2025-01/policies.json`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": TOKEN } });
  const { policies = [] } = await res.json();

  const shipping = policies.find(p => /shipping/i.test(p.title || ""));
  if (!shipping) return [];
  return [{
    id:   `policy:shipping`,
    text: `${shipping.title}\n\n${shipping.body || ""}`
  }];
}

/**
 * Fetch active Discount Codes via Price Rules + Discount Codes API.
 */
export async function fetchDiscountCodes() {
  const prRes = await fetch(
    `https://${SHOP}/admin/api/2025-01/price_rules.json?limit=250`,
    { headers: { "X-Shopify-Access-Token": TOKEN } }
  );
  const { price_rules = [] } = await prRes.json();

  const codes = [];
  for (const rule of price_rules) {
    if (!rule.starts_at || (rule.ends_at && new Date(rule.ends_at) < new Date())) continue;
    const dcRes = await fetch(
      `https://${SHOP}/admin/api/2025-01/price_rules/${rule.id}/discount_codes.json`,
      { headers: { "X-Shopify-Access-Token": TOKEN } }
    );
    const { discount_codes = [] } = await dcRes.json();
    for (const dc of discount_codes) {
      if (dc.code) {
        codes.push({
          id:   `discount:${dc.id}`,
          text: `Code: ${dc.code} (${rule.value_type} ${rule.value})`
        });
      }
    }
  }
  return codes;
}
