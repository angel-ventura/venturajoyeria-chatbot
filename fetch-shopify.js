// fetch-shopify.js
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const SHOP  = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

export async function fetchProducts() {
  let all = [];
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

  return all
    .filter(p => p.status === "active")
    .map(p => {
      const title     = p.title || "Sin título";
      const desc      = (p.body_html || "").replace(/<[^>]+>/g, "").trim();
      const handle    = p.handle || "";
      const image     = Array.isArray(p.images) && p.images[0]?.src ? p.images[0].src : "";
      // assume first variant is the one to price
      const price     = (Array.isArray(p.variants) && p.variants[0]?.price) 
                          ? p.variants[0].price 
                          : "";

      return {
        id:   `product:${p.id}`,
        text: `${title}\n\n${desc}`,
        metadata: { title, handle, image, price }
      };
    });
}
