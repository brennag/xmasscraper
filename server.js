// server.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const NodeCache = require('node-cache');
const { chromium } = require('playwright');

const app = express();
app.use(helmet());
app.use(morgan('tiny'));

const cache = new NodeCache({ stdTTL: process.env.CACHE_TTL_SECONDS || 900 });

/** Normalize a string to £99.99 */
function normalizeGBP(raw) {
  if (!raw) return null;
  const match = String(raw).match(/£\s?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?/);
  if (!match) return null;
  return match[0].replace(/\s/g, '').replace(/,/g, '');
}

/** Extract domain for display */
function getStore(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host;
  } catch {
    return url;
  }
}

/** Price extractor */
async function extractPrice(page) {
  // JSON-LD
  try {
    const jsons = await page.$$eval('script[type="application/ld+json"]', els => els.map(e => e.innerText));
    for (const text of jsons) {
      try {
        const data = JSON.parse(text);
        const node = Array.isArray(data) ? data[0] : data;
        const price = node?.offers?.price || node?.offers?.priceSpecification?.price;
        if (price) return normalizeGBP('£' + price);
      } catch {}
    }
  } catch {}

  // Meta tags
  const metas = [
    'meta[property="product:price:amount"]',
    'meta[itemprop="price"]',
    'meta[name="twitter:data1"]'
  ];
  for (const sel of metas) {
    const content = await page.$eval(sel, el => el.content).catch(() => null);
    if (content) {
      const val = normalizeGBP('£' + content);
      if (val) return val;
    }
  }

  // Common price selectors
  const selectors = [
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '#corePrice_feature_div .a-offscreen',
    '.product-price__price',
    '.price--main',
    '.priceView-hero-price__value',
    '.product-price',
    '.c-price',
    '.price'
  ];

  for (const sel of selectors) {
    const txt = await page.$eval(sel, el => el.innerText).catch(() => null);
    const val = normalizeGBP(txt);
    if (val) return val;
  }

  // fallback: full text search
  const body = await page.evaluate(() => document.body.innerText);
  return normalizeGBP(body);
}

/** Middleware: simple API key */
app.use((req, res, next) => {
  const key = req.query.key;
  if (process.env.SCRAPER_KEY && key !== process.env.SCRAPER_KEY) {
    return res.status(401).json({ error: 'Unauthorized - invalid key' });
  }
  next();
});

/** Scrape route */
app.get('/scrape', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing ?url=' });

  const cacheKey = `price:${url}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'], headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2000);

    const price = await extractPrice(page);
    const title = await page.title();
    const store = getStore(url);
    const timestamp = new Date().toISOString();

    const result = { url, title, store, price, timestamp };
    cache.set(cacheKey, result);
    await browser.close();

    return res.json(result);
  } catch (err) {
    if (browser) await browser.close();
    console.error('Error scraping', err);
    return res.status(500).json({ error: 'Scrape failed', message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ UK Price Scraper running on port ${PORT}`));