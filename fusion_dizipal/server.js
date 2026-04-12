"use strict";
// Fusion Dizipal Addon - v1.1.0 (No-Dependency CORS & Apple TV Fix)

const express = require("express");
const fs = require("fs");
const path = require("path");
const https = require("https");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

// ── Konfigürasyon ─────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync("/data/options.json")) {
      return JSON.parse(fs.readFileSync("/data/options.json", "utf8"));
    }
  } catch (e) {}
  return {};
}

const opts = loadConfig();
const CONFIG = {
  BASE_URL:   opts.base_url  || "https://dizipal.im",
  PORT:       Number(opts.port || 7860),
  CACHE_TTL_MS: (Number(opts.cache_ttl_hours || 12)) * 60 * 60 * 1000,
  TIMEOUT_MS: Number(opts.timeout_ms || 45000),
  CHROMIUM_PATH: "/usr/bin/chromium",
  UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

// ── Cache ─────────────────────────────────────────────────────────────────────
const m3u8Cache  = new Map();
const slugCache  = new Map();
const titleCache = new Map();

function cacheGet(map, key, ttl) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > ttl) { map.delete(key); return null; }
  return entry.value;
}
function cacheSet(map, key, value) {
  map.set(key, { value, fetchedAt: Date.now() });
}

// ── Puppeteer ─────────────────────────────────────────────────────────────────
function launchOptions() {
  return {
    executablePath: CONFIG.CHROMIUM_PATH,
    headless: "new",
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-gpu", "--disable-extensions", "--no-first-run", "--mute-audio",
      "--window-size=1280,720",
      `--user-agent=${CONFIG.UA}`,
    ],
    defaultViewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    timeout: CONFIG.TIMEOUT_MS,
  };
}

// ── IMDb başlık al ────────────────────────────────────────────────────────────
function fetchTitle(imdbId) {
  return new Promise((resolve) => {
    const cached = cacheGet(titleCache, imdbId, 7 * 24 * 60 * 60 * 1000);
    if (cached) { resolve(cached); return; }
    const url = `https://www.omdbapi.com/?i=${imdbId}&apikey=trilogy`;
    https.get(url, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.Title) {
            cacheSet(titleCache, imdbId, json.Title);
            resolve(json.Title);
          } else resolve(null);
        } catch (e) { resolve(null); }
      });
    }).on("error", () => resolve(null));
  });
}

function toSlug(title) {
  return title
    .toLowerCase()
    .replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s")
    .replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c")
    .replace(/[^a-z0-9\s-]/g,"")
    .trim().replace(/\s+/g,"-");
}

async function findDizipalUrl(imdbId, type, season, episode) {
  const cacheKey = `${imdbId}:${season}:${episode}`;
  const cached = cacheGet(slugCache, cacheKey, CONFIG.CACHE_TTL_MS);
  if (cached) return cached;

  const title = await fetchTitle(imdbId);
  if (!title) throw new Error(`Başlık bulunamadı`);

  const slug = toSlug(title);
  let url = (type === "movie" || !season || !episode) 
    ? `${CONFIG.BASE_URL}/${slug}/` 
    : `${CONFIG.BASE_URL}/bolum/${slug}-${season}-sezon-${episode}-bolum-izle/`;

  cacheSet(slugCache, cacheKey, url);
  return url;
}

// ── Scraper ───────────────────────────────────────────────────────────────────
async function scrapeM3U8(pageUrl) {
  const cached = cacheGet(m3u8Cache, pageUrl, CONFIG.CACHE_TTL_MS);
  if (cached) return cached;

  const browser = await puppeteer.launch(launchOptions());
  try {
    const m3u8 = await new Promise(async (resolve, reject) => {
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({
        "Accept-Language": "tr-TR,tr;q=0.9",
        "Referer": CONFIG.BASE_URL + "/",
      });
      await page.setRequestInterception(true);
      
      const BLOCK = new Set(["image","font","stylesheet"]);
      let resolved = false;

      const t = setTimeout(() => {
        if (!resolved) { resolved=true; reject(new Error("Timeout")); }
      }, CONFIG.TIMEOUT_MS);

      page.on("request", (req) => {
        if (BLOCK.has(req.resourceType())) { req.abort(); return; }
        if (req.url().includes(".m3u8")) {
          resolved = true;
          clearTimeout(t);
          resolve(req.url());
          return;
        }
        req.continue();
      });

      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });
        const iframeSrc = await page.evaluate(() => {
          const el = document.querySelector('iframe[src*="player"], iframe[src*="embed"], iframe');
          return el ? el.src : null;
        });
        if (iframeSrc && !iframeSrc.startsWith("about")) {
          await page.goto(iframeSrc, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });
        }
        await new Promise(r => setTimeout(r, 6000));
      } catch (e) {}
    });

    cacheSet(m3u8Cache, pageUrl, m3u8);
    return m3u8;
  } finally {
    await browser.close();
  }
}

// ── Express Sunucu ────────────────────────────────────────────────────────────
const app = express();

// MANUEL CORS AYARI (cors paketine ihtiyaç duymaz)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.get("/manifest.json", (req, res) => {
  const manifestPath = path.join(__dirname, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    res.sendFile(manifestPath);
  } else {
    res.json({
      id: "fusion.dizipal.addon",
      name: "Dizipal Fusion",
      description: "Apple TV Optimized Dizipal Addon",
      version: "1.1.0",
      resources: ["stream"],
      types: ["movie", "series"],
      idPrefixes: ["tt"]
    });
  }
});

app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  const cleanId = id.replace(".json", "");

  try {
    let dizipalUrl;
    const epMatch = cleanId.match(/^(tt\d+):(\d+):(\d+)$/);

    if (epMatch) {
      dizipalUrl = await findDizipalUrl(epMatch[1], "series", epMatch[2], epMatch[3]);
    } else {
      dizipalUrl = await findDizipalUrl(cleanId, type);
    }

    const m3u8Url = await scrapeM3U8(dizipalUrl);

    res.json({
      streams: [{
        name: "Dizipal · HLS",
        title: `⚡ Fusion Hızlı Kanal\n720p/1080p`,
        url: m3u8Url,
        behaviorHints: {
          notWebReady: false,
          bingeGroup: "dizipal-fusion",
          proxyHeaders: {
            request: {
              "User-Agent": CONFIG.UA,
              "Referer": CONFIG.BASE_URL + "/",
              "Origin": CONFIG.BASE_URL
            }
          }
        }
      }]
    });
  } catch (err) {
    console.error("[Error]", err.message);
    res.json({ streams: [] });
  }
});

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`🚀 Sunucu Çalışıyor: 110 http://0.0.0.0:${CONFIG.PORT}`);
});
