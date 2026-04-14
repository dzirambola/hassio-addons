"use strict";

/**
 * Fusion Dizipal Addon - v1.4.2
 * Singleton Browser, Range Header Support, Optimized Logging & Cleanup
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
  VERSION: "1.4.2",
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

// 🚀 CORS Middleware (Manifest ve Stream erişimi için en başta)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

let _browser = null;
let _isLaunching = false;

async function getBrowser() {
  if (_browser && _browser.connected) return _browser;
  if (_isLaunching) {
    while (_isLaunching) { await new Promise(r => setTimeout(r, 500)); }
    return _browser;
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

async function scrapeM3U8(pageUrl) {
  const cached = cacheGet(`m3u8:${pageUrl}`, CONFIG.CACHE_TTL_MS);
  if (cached) {
    log(`Önbellekten alındı (Cache Hit) - Tarayıcı açılmadı.`, "DEBUG");
    return cached;
  }

  const startTime = Date.now(); // ⏱ 1. Süre ölçümü başlangıcı
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
    await page.setExtraHTTPHeaders({ "Referer": CONFIG.BASE_URL + "/" });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "font", "stylesheet", "media"].includes(type) || req.url().includes("google")) {
        req.abort();
      } else {
        req.continue();
      }
    });

    return await new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Zaman aşımı: Link bulunamadı.")), CONFIG.TIMEOUT_MS);

      page.on("request", (req) => {
        if (req.url().includes(".m3u8")) { 
            const duration = ((Date.now() - startTime) / 1000).toFixed(1); // ⏱ 1. Süre hesaplama
            log(`Link yakalandı: ${req.url().split('?')[0]} (${duration} saniye sürdü)`);
            clearTimeout(timeout); 
            cacheSet(`m3u8:${pageUrl}`, req.url());
            resolve(req.url()); 
        }
      });

      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
        const iframe = await page.evaluate(() => document.querySelector('iframe[src*="player"], iframe[src*="embed"]')?.src);
        if (iframe) await page.goto(iframe, { waitUntil: "domcontentloaded" });
      } catch (e) { log(`Navigasyon uyarısı: ${e.message}`, "DEBUG"); }
    });
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

app.get("/proxy-stream", (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl || !targetUrl.startsWith('http')) return res.status(403).send("Forbidden");
  
  const options = { 
    headers: { 
      "User-Agent": CONFIG.UA, 
      "Referer": CONFIG.BASE_URL + "/", 
      "Origin": CONFIG.BASE_URL,
      ...(req.headers.range && { "Range": req.headers.range })
    } 
  };
  
  const pReq = (targetUrl.startsWith('https') ? https : http).get(targetUrl, options, (pRes) => {
    res.writeHead(pRes.statusCode, pRes.headers);
    pRes.pipe(res);
    req.on('close', () => pRes.destroy());
  });

  pReq.on('error', () => res.sendStatus(500));
  req.on('close', () => { 
    if (!pReq.destroyed) {
        pReq.destroy();
        log(`İstemci ayrıldı, proxy sonlandırıldı.`, "INFO");
    }
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

app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  const cleanId = id.replace(".json", "");
  
  try {
    let title, dizipalUrl, streamTitle;
    const epMatch = cleanId.match(/^(tt\d+):(\d+):(\d+)$/);

    if (epMatch) { 
      title = await fetchTitle(epMatch[1]);
      if (!title) throw new Error("Title yok");
      log(`İçerik Çözümlendi: ${title} (S${epMatch[2]} E${epMatch[3]})`, "INFO"); // 🎬 3. İsim logu
      dizipalUrl = `${CONFIG.BASE_URL}/bolum/${toSlug(title)}-${epMatch[2]}-sezon-${epMatch[3]}-bolum-izle/`;
      streamTitle = `📺 Dizi Bölümü\n⚙️ Kalite: Auto / HD\n🎬 ${title} (S${epMatch[2].padStart(2, '0')}E${epMatch[3].padStart(2, '0')})`;
    } else { 
      title = await fetchTitle(cleanId);
      if (!title) throw new Error("Title yok");
      log(`İçerik Çözümlendi: ${title}`, "INFO"); // 🎬 3. İsim logu
      dizipalUrl = `${CONFIG.BASE_URL}/${toSlug(title)}/`;
      streamTitle = `🎥 Sinema Filmi\n⚙️ Kalite: Auto / HD\n🎬 ${title}`;
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
    log(`Hata: ${err.message}`, "ERROR");
    res.json({ streams: [] });
  }
});

// 🧹 Eski logları temizleyerek başla
app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.clear(); 
  log(`=============================================`, "SYSTEM");
  log(`Fusion Addon v${CONFIG.VERSION} Port ${CONFIG.PORT} aktif`, "SYSTEM");
  log(`Eski oturum logları temizlendi, sistem hazır.`, "SYSTEM");
  log(`=============================================`, "SYSTEM");
});
