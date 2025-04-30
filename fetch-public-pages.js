// ==================== fetch-public-pages.js ====================
const axiosPub = require('axios');
const cheerio = require('cheerio');

async function fetchPublicPages(urls) {
  const pages = [];
  for (const url of urls) {
    try {
      const { data: html } = await axiosPub.get(url);
      const $ = cheerio.load(html);
      const text = $('main, article').text().trim() || $('body').text().trim();
      pages.push({ url, content: text });
    } catch (err) {
      console.error(`Error fetching ${url}:`, err.message);
    }
  }
  return pages;
}

module.exports = { fetchPublicPages };
