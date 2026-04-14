"use strict";
/**
 * Fusion Dizipal Addon - v1.3.4 (Optimized, Singleton & Accurate Titles)
 */

const express = require("express");
const fs = require("fs");
const https = require("https");
const http = require("http");
const { addExtra } = require('puppeteer-extra');
const puppeteer = addExtra(require('puppeteer-core'));
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

// ── 1. Yapılandırma ─────────────────────────────────────────────────────────
const opts = (() => {
  try { return fs.existsSync("/data/options.json") ? JSON.parse(fs.readFileSync("/data/options.json", "utf8")) : {}; } catch (e) { return {}; }
})();

const CONFIG = {
  VERSION: "1.3.4",
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

// ── 2. Singleton Browser Yönetimi ───────────────────────────────────────────
let _browser = null;

async function getBrowser() {
  if (_browser && _browser.connected) return _browser;
  
  log("Tarayıcı örneği başlatılıyor...");
  _browser = await puppeteer.launch({
    executablePath: CONFIG.CHROMIUM_PATH,
    headless: CONFIG.HEADLESS,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--no-zygote"]
  });
  
  _browser.on('disconnected', () => {
    log("Tarayıcı bağlantısı koptu, bir sonraki istekte yeniden başlatılacak.", "WARN");
    _browser = null;
  });
  
  return _browser;
}

// ── 3. Yardımcı Fonksiyonlar & Önbellek ───────────────────────────────────────
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

// Temizlik: Süresi dolan önbelleği saat başı sil
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

// ── 4. Dinamik Scraper ────────────────────────────────────────────────────────
async function scrapeM3U8(pageUrl) {
  const cached = cacheGet(`m3u8:${pageUrl}`, CONFIG.CACHE_TTL_MS);
  if (cached) return cached;

  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
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
      const timeout = setTimeout(() => {
        page.close().catch(() => {});
        reject(new Error("Zaman aşımı: Yayın linki bulunamadı."));
      }, CONFIG.TIMEOUT_MS);

      page.on("request", (req) => {
        if (req.url().includes(".m3u8")) { 
            log(`m3u8 yakalandı: ${req.url().split('?')[0]}...`);
            clearTimeout(timeout); 
            cacheSet(`m3u8:${pageUrl}`, req.url());
            page.close().catch(() => {}); // Sekmeyi kapat
            resolve(req.url()); 
        }
      });

      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
        const iframe = await page.evaluate(() => document.querySelector('iframe[src*="player"], iframe[src*="embed"]')?.src);
        if (iframe) {
            log(`Iframe tespit edildi, yönleniliyor...`);
            await page.goto(iframe, { waitUntil: "domcontentloaded" });
        }
      } catch (e) {
        log(`Navigasyon hatası: ${e.message}`, "ERROR");
      }
    });
  } catch (err) {
    await page.close().catch(() => {});
    throw err;
  }
}

// ── 5. Proxy & Routes ──────────────────────────────────────────────────────────
app.get("/proxy-stream", (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || !targetUrl.startsWith('http') || !targetUrl.includes('.m3u8')) {
    return res.status(403).send("Geçersiz Proxy İsteği");
  }
  
  const options = { headers: { "User-Agent": CONFIG.UA, "Referer": CONFIG.BASE_URL + "/", "Origin": CONFIG.BASE_URL } };
  const pReq = (targetUrl.startsWith('https') ? https : http).get(targetUrl, options, (pRes) => {
    res.writeHead(pRes.statusCode, pRes.headers);
    pRes.pipe(res);
  });
  
  pReq.on('error', () => res.sendStatus(500));
});

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
  log(`İstek Alındı: ${type} - ${cleanId}`);

  try {
    let title, dizipalUrl, streamTitle;
    const epMatch = cleanId.match(/^(tt\d+):(\d+):(\d+)$/);

    if (epMatch) { // Dizi
      title = await fetchTitle(epMatch[1]);
      if (!title) throw new Error("Başlık çözülemedi");
      dizipalUrl = `${CONFIG.BASE_URL}/bolum/${toSlug(title)}-${epMatch[2]}-sezon-${epMatch[3]}-bolum-izle/`;
      // Çözünürlük ibaresi "Auto / HD" olarak güncellendi
      streamTitle = `Auto / HD · ${title} S${epMatch[2].padStart(2, '0')}E${epMatch[3].padStart(2, '0')}`;
    } else { // Film
      title = await fetchTitle(cleanId);
      if (!title) throw new Error("Başlık çözülemedi");
      dizipalUrl = `${CONFIG.BASE_URL}/${toSlug(title)}/`;
      // Çözünürlük ibaresi "Auto / HD" olarak güncellendi
      streamTitle = `Auto / HD · ${title}`;
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
    log(`İşlem Hatası: ${err.message}`, "ERROR");
    res.json({ streams: [] });
  }
});

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  log(`Fusion Addon v${CONFIG.VERSION} Port ${CONFIG.PORT} üzerinden yayında`);
});
