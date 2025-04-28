// fetch-shopify.js
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const SHOP  = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

/**
 * Fetch all ACTIVE products + variants via cursor-based pagination.
 * Only returns products with status === "active", mapping out handle & image.
 */
export async function fetchProducts() {
  let all = [];
  // include status, handle, images
  let url = `https://${SHOP}/admin/api/2025-01/products.json?limit=250&fields=id,title,handle,body_html,variants,images,status`;

  while (url) {
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": TOKEN }
    });
    if (!res.ok) {
      throw new Error(`Shopify fetchProducts ${res.status}: ${await res.text()}`);
    }
    const { products = [] } = await res.json();
    all = all.concat(products);
    const link = res.headers.get("link");
    if (link && link.includes('rel="next"')) {
      const m = link.match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
    } else {
      url = null;
    }
  }

  // Keep only ACTIVE products
  return all
    .filter(p => p.status === "active")
    .map(p => {
      const title     = p.title || "Sin título";
      const desc      = (p.body_html || "").replace(/<[^>]+>/g, "").trim();
      const inventory = Array.isArray(p.variants)
        ? p.variants.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0)
        : 0;
      const handle    = p.handle || "";
      const image     = Array.isArray(p.images) && p.images[0]?.src
        ? p.images[0].src
        : "";

      return {
        id:   `product:${p.id}`,
        text: `${title}\n\n${desc}`,
        metadata: { title, inventory, handle, image }
      };
    });
}
