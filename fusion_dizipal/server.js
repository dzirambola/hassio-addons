"use strict";

/**
 * Fusion Dizipal Addon - v1.4.6 (Final / Enterprise Stable)
 * HAOS Optimized, Memory Leak Protected & Apple Media Player Compatible
 */

const express = require("express");
const fs = require("fs");
const https = require("https");
const http = require("http");
const { addExtra } = require('puppeteer-extra');
const puppeteer = addExtra(require('puppeteer-core'));
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const opts = (() => {
  try { return fs.existsSync("/data/options.json") ? JSON.parse(fs.readFileSync("/data/options.json", "utf8")) : {}; } catch (e) { return {}; }
})();

const CONFIG = {
  VERSION: "1.4.6",
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

// Gelişmiş CORS ve Apple Player Uyumluluğu
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Range");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Encoding, Content-Length, Content-Range");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

let _browser = null;
let _isLaunching = false;

async function getBrowser() {
  if (_browser && _browser.connected) return _browser;
  if (_isLaunching) {
    while (_isLaunching) { await new Promise(r => setTimeout(r, 500)); }
    return getBrowser(); // Recursive kontrol
  }
  _isLaunching = true;
  try {
    log("Tarayıcı örneği başlatılıyor...", "SYSTEM");
    _browser = await puppeteer.launch({
      executablePath: CONFIG.CHROMIUM_PATH,
      headless: CONFIG.HEADLESS,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--disable-gpu"]
    });
    _browser.on('disconnected', () => { _browser = null; });
  } finally {
    _isLaunching = false;
  }
  return _browser;
}

function log(msg, type = "INFO") {
  // Logları Türkiye saat dilimine (HAOS UTC olsa bile) zorla
  const timestamp = new Date().toLocaleString("tr-TR", { 
    timeZone: "Europe/Istanbul",
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  console.log(`[${timestamp}] [${type}] ${msg}`);
}

const cache = new Map();
const cacheSet = (key, val) => cache.set(key, { v: val, t: Date.now() });
const cacheGet = (key, ttl) => {
  const e = cache.get(key);
  if (!e || (Date.now() - e.t > ttl)) return null;
  return e.v;
};

// Rutin Cache Temizliği
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    const ttl = key.startsWith('m3u8') ? CONFIG.CACHE_TTL_MS : 7 * 24 * 60 * 60 * 1000;
    if (now - value.t > ttl) cache.delete(key);
  }
}, 3600000);

// 7/24 Tarayıcı Geri Dönüşüm Mekanizması (RAM Optimizasyonu & Çatışma Koruması)
setInterval(async () => {
  if (_browser && _browser.connected) {
    try {
      const pages = await _browser.pages();
      // about:blank dışında sayfa varsa aktif bir işlem (örneğin film arama) vardır, atla.
      if (pages.length > 1) {
        log("Aktif işlem tespit edildi, RAM optimizasyonu ertelendi.", "SYSTEM");
        return; 
      }
      log("Rutin bakım: RAM optimizasyonu için tarayıcı instance'ı sıfırlanıyor...", "SYSTEM");
      await _browser.close().catch(() => {});
      _browser = null; 
    } catch (e) {}
  }
}, 12 * 60 * 60 * 1000);

function toSlug(title) {
  return title.toLowerCase()
    .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s")
    .replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c")
    .replace(/[^a-z0-9\s-]/g,"").trim().replace(/\s+/g,"-");
}

async function fetchTitle(imdbId) {
  const cached = cacheGet(`title:${imdbId}`, 7 * 24 * 60 * 60 * 1000);
  if (cached) return cached;
  return new Promise((resolve, reject) => {
    https.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=${CONFIG.OMDB_KEY}`, (res) => {
      let d = ""; res.on("data", (c) => d += c);
      res.on("end", () => {
        try { 
            const j = JSON.parse(d); 
            if (j.Response === "True") { 
                cacheSet(`title:${imdbId}`, j.Title); 
                resolve(j.Title); 
            } else reject(new Error(j.Error || "API Hatası")); 
        } catch (e) { reject(new Error("JSON Ayrıştırma Hatası")); }
      });
    }).on("error", () => reject(new Error("OMDb Bağlantı Hatası")));
  });
}

async function scrapeM3U8(pageUrl) {
  const cached = cacheGet(`m3u8:${pageUrl}`, CONFIG.CACHE_TTL_MS);
  if (cached) return cached;

  const startTime = Date.now();
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
    await page.setExtraHTTPHeaders({ "Referer": CONFIG.BASE_URL + "/" });
    await page.setRequestInterception(true);
    
    page.on("request", (req) => {
      if (req.isInterceptResolutionHandled()) return;
      const type = req.resourceType();
      if (["image", "font", "stylesheet", "media"].includes(type) || req.url().includes("google")) {
        req.abort().catch(() => {});
      } else {
        req.continue().catch(() => {});
      }
    });

    return await new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Zaman aşımı: Yayın linki bulunamadı.")), CONFIG.TIMEOUT_MS);

      page.on("request", (req) => {
        if (req.url().includes(".m3u8")) { 
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            log(`Link yakalandı: ${req.url().split('?')[0]} (${duration}s)`);
            clearTimeout(timeout); 
            cacheSet(`m3u8:${pageUrl}`, req.url());
            resolve(req.url()); 
        }
      });

      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });
        const iframe = await page.evaluate(() => document.querySelector('iframe[src*="player"], iframe[src*="embed"]')?.src);
        if (iframe) await page.goto(iframe, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });
      } catch (e) { log(`Navigasyon: ${e.message}`, "DEBUG"); }
    });
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

app.get("/proxy-stream", (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || !targetUrl.startsWith('http')) return res.status(403).send("Forbidden");
  
  // Hedef CDN'in kök domainini dinamik al
  const targetOrigin = new URL(targetUrl).origin;

  const options = { 
    headers: { 
      "User-Agent": CONFIG.UA, 
      "Referer": CONFIG.BASE_URL + "/", 
      "Origin": targetOrigin, // Dinamik CDN adresi (403 engelleme)
      ...(req.headers.range && { "Range": req.headers.range })
    } 
  };
  
  const pReq = (targetUrl.startsWith('https') ? https : http).get(targetUrl, options, (pRes) => {
    res.writeHead(pRes.statusCode, pRes.headers);
    pRes.pipe(res);
    
    // Yalnızca akış hatalarında veya bitişte pRes'i temizle
    pRes.on('error', () => { if (!pRes.destroyed) pRes.destroy(); });
  });

  pReq.setTimeout(15000, () => { pReq.destroy(); });

  pReq.on('error', (err) => {
    log(`Proxy Hatası: ${err.message}`, "DEBUG");
    if (!res.headersSent) res.sendStatus(500);
    else res.end();
  });

  // İstemci koptuğunda HER ŞEYİ tek bir yerden imha et (MaxListeners sızıntısını önler)
  req.on('close', () => { 
    if (!pReq.destroyed) pReq.destroy(); 
  });
});

app.get("/manifest.json", (req, res) => {
  res.json({
    id: "fusion.dizipal.clean",
    name: "Dizipal",
    version: CONFIG.VERSION,
    logo: CONFIG.LOGO_URL,
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "dizipal"],
    catalogs: [],
    behaviorHints: { configurable: false, configurationRequired: false }
  });
});

app.get("/stream/:type/:id.json", async (req, res, next) => {
  const { type, id } = req.params;
  const cleanId = id.replace(".json", "");
  
  try {
    let title, dizipalUrl, streamTitle;
    const epMatch = cleanId.match(/^(tt\d+):(\d+):(\d+)$/);

    if (epMatch) { 
      title = await fetchTitle(epMatch[1]);
      log(`Talep: ${title} (S${epMatch[2]} E${epMatch[3]})`);
      dizipalUrl = `${CONFIG.BASE_URL}/bolum/${toSlug(title)}-${epMatch[2]}-sezon-${epMatch[3]}-bolum-izle/`;
      streamTitle = `📺 Dizi: ${title} S${epMatch[2]}E${epMatch[3]}`;
    } else { 
      title = await fetchTitle(cleanId);
      log(`Talep: ${title}`);
      dizipalUrl = `${CONFIG.BASE_URL}/${toSlug(title)}/`;
      streamTitle = `🎥 Film: ${title}`;
    }

    const rawM3u8 = await scrapeM3U8(dizipalUrl);
    const host = req.get('host');
    const proxiedUrl = `http://${host}/proxy-stream?url=${encodeURIComponent(rawM3u8)}`;

    res.json({
      streams: [{
        name: "Dizipal\nProxy",
        title: streamTitle,
        description: `Kaynak: ${CONFIG.BASE_URL}\nKalite otomatik ayarlanır.`,
        url: proxiedUrl,
        behaviorHints: { 
            notWebReady: true,
            bingeGroup: `dizipal-binge-${cleanId.split(':')[0]}`,
            proxyHeaders: { request: { "User-Agent": CONFIG.UA, "Referer": CONFIG.BASE_URL + "/" } }
        }
      }]
    });
  } catch (err) {
    log(`HATA: ${err.message}`, "ERROR");
    let userMsg = "HATA: Link bulunamadı.";
    if (err.message.includes("API")) userMsg = "HATA: OMDb Limit/Key Hatası.";
    if (err.message.includes("Zaman aşımı")) userMsg = "HATA: Kaynak Site Cevap Vermedi.";

    res.json({
      streams: [{
        name: "⚠️ BİLGİ",
        title: userMsg,
        description: `Detay: ${err.message}\nLütfen ayarları kontrol edin.`,
        url: "http://error"
      }]
    });
  }
});

// Global Error Handler (Arayüz Koruması)
app.use((err, req, res, next) => {
  log(`Sistem Hatası Yakalandı: ${err.message}`, "ERROR");
  if (!res.headersSent) {
    res.json({
      streams: [{
        name: "⚠️ KRİTİK HATA",
        title: "Sistem Hatası",
        description: `Detay: ${err.message}\nEklenti loglarını kontrol edin.`,
        url: "http://error"
      }]
    });
  }
});

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  log(`=============================================`, "SYSTEM");
  log(`Fusion Addon v${CONFIG.VERSION} Port ${CONFIG.PORT} aktif`, "SYSTEM");
  log(`=============================================`, "SYSTEM");
});

// Graceful Shutdown (Zombi Chromium Süreçlerini Engelleme)
['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => {
  process.on(signal, async () => {
    log(`${signal} sinyali alındı. Sistem güvenli bir şekilde kapatılıyor...`, "SYSTEM");
    if (_browser) {
      await _browser.close().catch(() => {});
    }
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  log(`Beklenmeyen Kritik Hata: ${err.message}`, "ERROR");
});
