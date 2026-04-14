"use strict";
/**
 * Fusion Dizipal Addon - v1.3.2 (Optimized, Secured & Dynamic)
 */

const express = require("express");
const fs = require("fs");
const https = require("https");
const http = require("http");
const { addExtra } = require('puppeteer-extra');
const puppeteer = addExtra(require('puppeteer-core'));
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

// ── 1. Yapılandırma (Home Assistant Options Entegrasyonu) ──────────────────
const opts = (() => {
  try { return fs.existsSync("/data/options.json") ? JSON.parse(fs.readFileSync("/data/options.json", "utf8")) : {}; } catch (e) { return {}; }
})();

const CONFIG = {
  VERSION: "1.3.2",
  BASE_URL: opts.base_url || "https://dizipal.im",
  PORT: Number(opts.port || 7860),
  TIMEOUT_MS: Number(opts.timeout_ms || 45000),
  CACHE_TTL_MS: Number(opts.cache_ttl_hours || 12) * 60 * 60 * 1000,
  HEADLESS: opts.headless !== false ? "new" : false,
  OMDB_KEY: opts.omdb_api_key || "trilogy",
  CHROMIUM_PATH: "/usr/bin/chromium",
  UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  LOGO_URL: "https://raw.githubusercontent.com/dzirambola/hassio-addons/main/fusion_dizipal/image_0.png"
};

const app = express();

// ── 2. Yardımcı Fonksiyonlar & Önbellek Yönetimi ──────────────────────────────
function log(msg, type = "INFO") {
  const timestamp = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
  console.log(`[${timestamp}] [${type}] ${msg}`);
}

const cache = new Map();
const cacheSet = (key, val) => cache.set(key, { v: val, t: Date.now() });
const cacheGet = (key, ttl) => {
  const e = cache.get(key);
  if (!e || (Date.now() - e.t > ttl)) return null;
  return e.v;
};

// Bellek Sızıntısı Koruması: Her saat başı süresi dolan cache'leri temizle
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    const ttl = key.startsWith('m3u8') ? CONFIG.CACHE_TTL_MS : 7 * 24 * 60 * 60 * 1000;
    if (now - value.t > ttl) cache.delete(key);
  }
}, 3600000);

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
    https.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=${CONFIG.OMDB_KEY}`, (res) => {
      let d = ""; res.on("data", (c) => d += c);
      res.on("end", () => {
        try { 
            const j = JSON.parse(d); 
            if (j.Title) { 
                cacheSet(`title:${imdbId}`, j.Title); 
                resolve(j.Title); 
            } else resolve(null); 
        } catch (e) { resolve(null); }
      });
    }).on("error", () => resolve(null));
  });
}

// ── 3. Scraper ────────────────────────────────────────────────────────────────
async function scrapeM3U8(pageUrl) {
  log(`Kazıma işlemi başlatıldı: ${pageUrl}`);
  const cached = cacheGet(`m3u8:${pageUrl}`, CONFIG.CACHE_TTL_MS);
  if (cached) {
    log("İçerik cache'den getirildi.");
    return cached;
  }

  const browser = await puppeteer.launch({
    executablePath: CONFIG.CHROMIUM_PATH,
    headless: CONFIG.HEADLESS,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--no-zygote"]
  });

  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "Referer": CONFIG.BASE_URL + "/" });
    await page.setRequestInterception(true);

    page.on("request", (req) => {
      const type = req.resourceType();
      const url = req.url();
      const blockList = ["analytics", "adsbygoogle", "doubleclick", "facebook", "pixel", "adserver"];
      
      if (["image", "font", "stylesheet"].includes(type) || blockList.some(domain => url.includes(domain))) {
        req.abort();
      } else {
        req.continue();
      }
    });

    return await new Promise(async (resolve, reject) => {
      const t = setTimeout(() => {
        log("Timeout: m3u8 linki bulunamadı.", "WARN");
        reject(new Error("Timeout"));
      }, CONFIG.TIMEOUT_MS);

      page.on("request", (req) => {
        if (req.url().includes(".m3u8")) { 
            log(`m3u8 bulundu: ${req.url().split('?')[0]}...`);
            clearTimeout(t); 
            cacheSet(`m3u8:${pageUrl}`, req.url());
            resolve(req.url()); 
        }
      });

      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
        const iframe = await page.evaluate(() => document.querySelector('iframe[src*="player"], iframe[src*="embed"]')?.src);
        if (iframe) {
            log(`Iframe bulundu, yönleniliyor...`);
            await page.goto(iframe, { waitUntil: "domcontentloaded" });
        }
        await new Promise(r => setTimeout(r, 12000));
      } catch (e) {
        log(`Sayfa yükleme hatası: ${e.message}`, "ERROR");
      }
    });
  } finally { 
    await browser.close(); 
    log("Tarayıcı kapatıldı.");
  }
}

// ── 4. Proxy (SSRF Güvenliği Eklenmiş) ──────────────────────────────────────────
app.get("/proxy-stream", (req, res) => {
  const targetUrl = req.query.url;
  
  // Güvenlik Kontrolü: URL mevcut mu, http ile mi başlıyor ve m3u8 içeriyor mu?
  if (!targetUrl || !targetUrl.startsWith('http') || !targetUrl.includes('.m3u8')) {
    log(`Güvenlik: Geçersiz proxy isteği engellendi: ${targetUrl}`, "WARN");
    return res.status(403).send("Forbidden");
  }
  
  log(`Proxy isteği: ${targetUrl.split('?')[0]}`);
  const options = { headers: { "User-Agent": CONFIG.UA, "Referer": CONFIG.BASE_URL + "/", "Origin": CONFIG.BASE_URL } };
  
  const pReq = (targetUrl.startsWith('https') ? https : http).get(targetUrl, options, (pRes) => {
    res.writeHead(pRes.statusCode, pRes.headers);
    pRes.pipe(res);
  });
  
  pReq.on('error', (e) => {
    log(`Proxy Hatası: ${e.message}`, "ERROR");
    res.sendStatus(500);
  });
});

// ── 5. Stremio/Fusion Routes ────────────────────────────────────────────────────
app.get("/manifest.json", (req, res) => {
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
  log(`Yeni stream isteği - Tip: ${type}, ID: ${cleanId}`);

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
    log(`İşlem hatası: ${err.message}`, "ERROR");
    res.json({ streams: [] });
  }
});

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  log(`Fusion Addon v${CONFIG.VERSION} Port ${CONFIG.PORT} üzerinde çalışıyor`);
});
