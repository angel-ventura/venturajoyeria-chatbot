// fetch-shopify.js
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const SHOP  = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;

// … your existing fetchProducts & fetchPages here …

/**
 * Fetch Shipping Policy via Policies API.
 */
export async function fetchShippingPolicy() {
  const url = `https://${SHOP}/admin/api/2025-01/policies.json`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": TOKEN } });
  const { policies = [] } = await res.json();
  const shipping = policies.find(p => /shipping/i.test(p.title || ""));
  if (!shipping) return [];
  return [{ id:`policy:shipping`, text:`${shipping.title}\n\n${shipping.body || ""}` }];
}

/**
 * Fetch active Discount Codes via Price Rules + Discount Codes API.
 */
export async function fetchDiscountCodes() {
  const prUrl = `https://${SHOP}/admin/api/2025-01/price_rules.json?limit=250`;
  const prRes = await fetch(prUrl, { headers:{ "X-Shopify-Access-Token": TOKEN } });
  const { price_rules = [] } = await prRes.json();

  const codes = [];
  for (const rule of price_rules) {
    if (!rule.starts_at || (rule.ends_at && new Date(rule.ends_at) < new Date())) continue;
    const dcUrl = `https://${SHOP}/admin/api/2025-01/price_rules/${rule.id}/discount_codes.json`;
    const dcRes = await fetch(dcUrl, { headers:{ "X-Shopify-Access-Token": TOKEN } });
    const { discount_codes = [] } = await dcRes.json();
    discount_codes.forEach(dc => {
      if (dc.code) {
        codes.push({ id:`discount:${dc.id}`, text:`Code: ${dc.code} (${rule.value_type} ${rule.value})` });
      }
    });
  }
  return codes;
}

// Finally, export the functions you need:
export { fetchProducts, fetchPages, fetchShippingPolicy, fetchDiscountCodes };
