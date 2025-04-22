// fetch-public-pages.js
import fetch from "node-fetch";
import { load } from "cheerio";

/**
 * Download the given URL, parse HTML, extract main content or <body>,
 * and return an object with the URL and its cleaned text.
 */
export async function fetchPageText(url) {
  console.log("Fetching", url);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
  }
  const html = await res.text();
  const $ = load(html);

  // Try to grab the main Shopify content container (<main>, #MainContent, or .page-content),
  // otherwise fall back to the entire body
  const main = $("#MainContent, .page-content, main").first();
  const container = main.length ? main : $("body");

  // Extract and clean text
  const text = container
    .text()
    .trim()
    .replace(/\s+/g, " ");

  console.log(`→ ${url} : ${text.length} chars`);
  return { url, text };
}
