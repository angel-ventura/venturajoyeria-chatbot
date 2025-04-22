// fetch-shopify.js
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const SHOP  = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

/**
 * Fetch all products (title + description) from Shopify.
 * Returns [{ id: "product:<id>", text: "<plain-text>" }, ...]
 */
export async function fetchProducts() {
  const url = `https://${SHOP}/admin/api/2025-01/products.json?limit=250`;
  const res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": TOKEN }
  });
  const data = await res.json();
  const products = data.products || [];
  return products.map(p => ({
    id: `product:${p.id}`,
    text: `${p.title || ""}\n\n${(p.body_html || "").replace(/<[^>]+>/g, "")}`
  }));
}

/**
 * Fetch selected pages (Sobre Nosotros) by title from Shopify.
 * Returns [{ id: "page:<id>", text: "<plain-text>" }, ...]
 */
export async function fetchPages() {
  const url = `https://${SHOP}/admin/api/2025-01/pages.json?limit=50`;
  const res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": TOKEN }
  });
  const data = await res.json();
  const pages = data.pages || [];

  // adjust these titles to match your store’s actual page names:
  const wanted = ["Sobre Nosotros"];
  return pages
    .filter(p => wanted.includes(p.title))
    .map(p => ({
      id: `page:${p.id}`,
      text: `${p.title || ""}\n\n${(p.body_html || "").replace(/<[^>]+>/g, "")}`
    }));
}
