"use strict";

/**
 * Fusion Dizipal Addon - v1.3.1 (Optimized)
 * Refined for performance, stability and resource management.
 */

const express = require("express");
const fs = require("fs");
const https = require("https");
const http = require("http");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

// ── 1. Yapılandırma ──────────────────────────────────────────────────────────
const opts = (() => {
  try { return fs.existsSync("/data/options.json") ? JSON.parse(fs.readFileSync("/data/options.json", "utf8")) : {}; } catch (e) { return {}; }
})();

const CONFIG = {
  VERSION: "1.3.1",
  BASE_URL: opts.base_url || "https://dizipal.im",
  PORT: Number(opts.port || 7860),
  TIMEOUT_MS: opts.timeout_ms || 30000,
  CHROMIUM_PATH: "/usr/bin/chromium",
  UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  LOGO_URL: "https://raw.githubusercontent.com/dzirambola/hassio-addons/main/fusion_dizipal/image_0.png"
};

const app = express();

// ── 2. Yardımcı Fonksiyonlar ─────────────────────────────────────────────────
const cache = new Map();
const cacheSet = (key, val) => cache.set(key, { v: val, t: Date.now() });
const cacheGet = (key) => {
  const c = cache.get(key);
  if (!c) return null;
  // 12 saatlik cache (config'den çekilebilir)
  if (Date.now() - c.t > (opts.cache_ttl_hours || 12) * 3600000) {
    cache.delete(key);
    return null;
  }
  return c.v;
};

const toSlug = (str) => str.toLowerCase()
  .replace(/ /g, "-")
  .replace(/[^\w-]/g, "")
  .replace(/-+/g, "-");

async function fetchTitle(imdbId) {
  return new Promise((resolve) => {
    // Trilogy API anahtarı genelde halka açıktır ancak opsiyonlardan gelmesi daha güvenli
    const apiKey = opts.omdb_api_key || "trilogy";
    https.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}`, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json.Title || null);
        } catch (e) { resolve(imdbId); }
      });
    }).on("error", () => resolve(imdbId));
  });
}

// ── 3. Core Scraper (Puppeteer) ─────────────────────────────────────────────
async function scrapeM3U8(targetUrl) {
  const cached = cacheGet(targetUrl);
  if (cached) return cached;

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CONFIG.CHROMIUM_PATH,
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu"
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.UA);
    await page.setRequestInterception(true);

    // Gereksiz kaynakları engelle (Hız ve RAM tasarrufu)
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'font', 'stylesheet', 'media'].includes(type) && !req.url().includes(".m3u8")) {
        req.abort();
      } else {
        req.continue();
      }
    });

    let m3u8Url = null;
    
    // Akıllı Takip: Network üzerinden m3u8 linkini yakala
    const waitForM3u8 = new Promise((resolve) => {
      page.on('response', response => {
        const url = response.url();
        if (url.includes(".m3u8") && response.status() === 200) {
          m3u8Url = url;
          resolve(url);
        }
      });
    });

    // Sayfaya git ve m3u8 bekle (Race condition önleyici)
    await Promise.race([
      page.goto(targetUrl, { waitUntil: "networkidle2", timeout: CONFIG.TIMEOUT_MS }),
      waitForM3u8
    ]);

    // Eğer networkidle sonrası hala bulunamadıysa kısa bir ek süre tanı
    if (!m3u8Url) {
      try { await page.waitForTimeout(3000); } catch(e){}
    }

    if (m3u8Url) {
      cacheSet(targetUrl, m3u8Url);
      return m3u8Url;
    }
    throw new Error("M3U8 stream link not found");

  } finally {
    if (browser) {
      await browser.close().catch(e => console.error("Zombi tarayıcı hatası:", e));
    }
  }
}

// ── 4. Routes ───────────────────────────────────────────────────────────────

app.get("/manifest.json", (req, res) => {
  const manifest = JSON.parse(fs.readFileSync("./manifest.json", "utf8"));
  res.json(manifest);
});

app.get("/stream/:type/:id.json", async (req, res) => {
  const cleanId = req.params.id.replace(".json", "");
  
  try {
    let title, dizipalUrl, streamTitle;
    const epMatch = cleanId.match(/^(tt\d+):(\d+):(\d+)$/);

    if (epMatch) { // Dizi
      title = await fetchTitle(epMatch[1]);
      dizipalUrl = `${CONFIG.BASE_URL}/bolum/${toSlug(title)}-${epMatch[2]}-sezon-${epMatch[3]}-bolum-izle/`;
      streamTitle = `Fusion · ${title} S${epMatch[2].padStart(2, '0')}E${epMatch[3].padStart(2, '0')}`;
    } else { // Film
      title = await fetchTitle(cleanId);
      dizipalUrl = `${CONFIG.BASE_URL}/${toSlug(title)}/`;
      streamTitle = `Fusion · ${title}`;
    }

    const rawM3u8 = await scrapeM3U8(dizipalUrl);
    const host = req.get('host');
    // Referer kontrolünü aşmak için proxy üzerinden veriyoruz
    const proxiedUrl = `http://${host}/proxy-stream?url=${encodeURIComponent(rawM3u8)}`;

    res.json({
      streams: [{
        name: "Dizipal",
        title: streamTitle,
        url: proxiedUrl,
        behaviorHints: { notWebReady: true }
      }]
    });

  } catch (err) {
    console.error("Stream Error:", err.message);
    res.json({ streams: [] });
  }
});

// Stream Proxy (CORS & Referer Bypass)
app.get("/proxy-stream", (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("No URL");

  const protocol = target.startsWith("https") ? https : http;
  const proxyReq = protocol.get(target, {
    headers: {
      "User-Agent": CONFIG.UA,
      "Referer": CONFIG.BASE_URL,
      "Origin": CONFIG.BASE_URL
    }
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", () => res.status(500).send("Proxy error"));
});

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`Fusion Dizipal Addon v${CONFIG.VERSION} is active on port ${CONFIG.PORT}`);
});
