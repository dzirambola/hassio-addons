"use strict";
/**
 * Fusion Dizipal Addon - v1.3.1 (Kararlılık Güncellemesi)
 * Önerilen İyileştirmeler: Puppeteer Hata Yönetimi, Proxy Stabilitesi
 */

const express = require("express");
const fs = require("fs");
const path = require("path"); // Gerekirse manifest.json yüklemek için
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
  TIMEOUT_MS: 45000,
  CHROMIUM_PATH: "/usr/bin/chromium",
  UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  LOGO_URL: "https://raw.githubusercontent.com/dzirambola/fusion-dizipal-addon/main/fusion_dizipal/image_0.png"
};

const app = express();

// Cache Mekanizması (v1.3.0 ile aynı)
const cache = new Map();
const cacheSet = (key, val) => cache.set(key, { v: val, t: Date.now() });
const cacheGet = (key, ttl) => {
  const e = cache.get(key);
  if (!e || (Date.now() - e.t > ttl)) return null;
  return e.v;
};

// ── 2. Yardımcı Fonksiyonlar ────────────────────────────────────────────────────
function toSlug(title) {
  return title.toLowerCase()
    .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s")
    .replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c")
    .replace(/[^a-z0-9\s-]/g,"").trim().replace(/\s+/g,"-");
}

async function fetchTitle(imdbId) {
  const cached = cacheGet(`title:${imdbId}`, 7 * 24 * 60 * 60 * 1000);
  if (cached) return cached;
  return new Promise((resolve) => {
    https.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=trilogy`, (res) => {
      let d = ""; res.on("data", (c) => d += c);
      res.on("end", () => {
        try { const j = JSON.parse(d); if (j.Title) { cacheSet(`title:${imdbId}`, j.Title); resolve(j.Title); } else resolve(null); }
        catch (e) { resolve(null); }
      });
    }).on("error", () => resolve(null));
  });
}

// ── 3. Scraper (İYİLEŞTİRİLDİ) ────────────────────────────────────────────────
async function scrapeM3U8(pageUrl) {
  const cached = cacheGet(`m3u8:${pageUrl}`, 12 * 60 * 60 * 1000);
  if (cached) return cached;

  const browser = await puppeteer.launch({
    executablePath: CONFIG.CHROMIUM_PATH,
    headless: "new",
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", 
      "--no-zygote", "--single-process", "--disable-gpu" // RAM tasarrufu
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "Referer": CONFIG.BASE_URL + "/" });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image", "font", "stylesheet"].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    return await new Promise(async (resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Timeout")), CONFIG.TIMEOUT_MS);
      page.on("request", (req) => {
        if (req.url().includes(".m3u8")) { clearTimeout(t); resolve(req.url()); }
      });

      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });
        const iframe = await page.evaluate(() => document.querySelector('iframe[src*="player"], iframe[src*="embed"]')?.src);
        if (iframe) await page.goto(iframe, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });
        await new Promise(r => setTimeout(r, 10000));
      } catch (e) { /* m3u8 yakalandıysa hata önemsiz */ }
    });
  } catch (err) {
    throw err; // Hatayı stream handler'a ilet
  } finally {
    // CRITICAL: Tarayıcının her durumda kapandığından emin ol
    if (browser) await browser.close();
  }
}

// ── 4. Proxy (İYİLEŞTİRİLDİ) ──────────────────────────────────────────────────
app.get("/proxy-stream", (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.sendStatus(400);

  console.log(`[Proxy] İstek: ${targetUrl.substring(0, 50)}...`);

  const options = { 
    headers: { 
      "User-Agent": CONFIG.UA, 
      "Referer": CONFIG.BASE_URL + "/", 
      "Origin": CONFIG.BASE_URL 
    } 
  };

  const pReq = (targetUrl.startsWith('https') ? https : http).get(targetUrl, options, (pRes) => {
    // Oynatıcıya doğru MIME tipini (video/mp4, application/vnd.apple.mpegurl vb.) ilet
    if (pRes.headers['content-type']) {
      res.setHeader('Content-Type', pRes.headers['content-type']);
    }
    res.writeHead(pRes.statusCode);
    pRes.pipe(res);
  });

  pReq.on('error', (err) => {
    console.error(`[Proxy Hata] ${err.message}`);
    res.sendStatus(500);
  });
});

// ── 5. Stremio/Fusion Routes ────────────────────────────────────────────────────
app.get("/manifest.json", (req, res) => {
  // server.js içindeki manifest her zaman güncel kalsın
  res.json({
    id: "fusion.dizipal.clean",
    name: "Dizipal",
    version: CONFIG.VERSION,
    logo: CONFIG.LOGO_URL,
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
  });
});

app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  const cleanId = id.replace(".json", "");

  try {
    let title, dizipalUrl, streamTitle;
    const epMatch = cleanId.match(/^(tt\d+):(\d+):(\d+)$/);

    if (epMatch) { // Dizi
      title = await fetchTitle(epMatch[1]);
      if (!title) throw new Error("Title bulunamadı");
      dizipalUrl = `${CONFIG.BASE_URL}/bolum/${toSlug(title)}-${epMatch[2]}-sezon-${epMatch[3]}-bolum-izle/`;
      streamTitle = `1080p · ${title} S${epMatch[2].padStart(2, '0')}E${epMatch[3].padStart(2, '0')}`;
    } else { // Film
      title = await fetchTitle(cleanId);
      if (!title) throw new Error("Title bulunamadı");
      dizipalUrl = `${CONFIG.BASE_URL}/${toSlug(title)}/`;
      streamTitle = `1080p · ${title}`;
    }

    const rawM3u8 = await scrapeM3U8(dizipalUrl);
    const host = req.get('host');
    const proxiedUrl = `http://${host}/proxy-stream?url=${encodeURIComponent(rawM3u8)}`;

    res.json({
      streams: [{
        name: "Dizipal",
        title: streamTitle,
        url: proxiedUrl,
        behaviorHints: { 
            notWebReady: true,
            proxyHeaders: { request: { "User-Agent": CONFIG.UA, "Referer": CONFIG.BASE_URL + "/" } }
        }
      }]
    });
  } catch (err) {
    console.error(`[Stream Hata] ${err.message}`);
    res.json({ streams: [] });
  }
});

// CORS Ayarları
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

// Health Check (Docker için)
app.get("/health", (req, res) => res.send("OK"));

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`\nFusion Addon v${CONFIG.VERSION} çalışıyor`);
});
