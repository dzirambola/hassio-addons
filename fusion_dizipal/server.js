"use strict";
// Fusion Dizipal Addon - v1.0.5

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
  BASE_URL: opts.base_url || "https://dizipal.im",
  PORT: Number(opts.port || 7860),
  ADDON_URL: opts.addon_url || "http://192.168.2.145:7860",
  CACHE_TTL_MS: (Number(opts.cache_ttl_hours || 12)) * 60 * 60 * 1000,
  TIMEOUT_MS: Number(opts.timeout_ms || 45000),
  CHROMIUM_PATH: "/usr/bin/chromium",
};
console.log("[config]", CONFIG);

// ── Cache ─────────────────────────────────────────────────────────────────────
const m3u8Cache = new Map();
const slugCache = new Map();
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

// ── Puppeteer seçenekleri ─────────────────────────────────────────────────────
function launchOptions() {
  return {
    executablePath: CONFIG.CHROMIUM_PATH,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--no-first-run",
      "--mute-audio",
      "--window-size=1280,720",
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ],
    defaultViewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    timeout: CONFIG.TIMEOUT_MS,
  };
}

// ── IMDb ID'den başlık al ─────────────────────────────────────────────────────
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
            console.log(`[title] ${imdbId} → "${json.Title}"`);
            cacheSet(titleCache, imdbId, json.Title);
            resolve(json.Title);
          } else resolve(null);
        } catch (e) { resolve(null); }
      });
    }).on("error", () => resolve(null));
  });
}

// ── Başlığı Dizipal slug formatına çevir ──────────────────────────────────────
function toSlug(title) {
  return title
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

// ── Dizipal URL oluştur ───────────────────────────────────────────────────────
async function findDizipalUrl(imdbId, type, season, episode) {
  const cacheKey = `${imdbId}:${season}:${episode}`;
  const cached = cacheGet(slugCache, cacheKey, CONFIG.CACHE_TTL_MS);
  if (cached) { console.log(`[slug] Cache: ${cached}`); return cached; }

  const title = await fetchTitle(imdbId);
  if (!title) throw new Error(`Başlık alınamadı: ${imdbId}`);
  console.log(`[slug] Başlık: "${title}"`);

  const slug = toSlug(title);
  console.log(`[slug] Slug: "${slug}"`);

  let url;
  if (type === "movie" || !season || !episode) {
    url = `${CONFIG.BASE_URL}/${slug}/`;
  } else {
    url = `${CONFIG.BASE_URL}/bolum/${slug}-${season}-sezon-${episode}-bolum-izle/`;
  }

  console.log(`[slug] URL: ${url}`);
  cacheSet(slugCache, cacheKey, url);
  return url;
}

// ── M3U8 yakala ───────────────────────────────────────────────────────────────
async function scrapeM3U8(pageUrl) {
  const cached = cacheGet(m3u8Cache, pageUrl, CONFIG.CACHE_TTL_MS);
  if (cached) { console.log(`[scraper] Cache: ${pageUrl}`); return cached; }

  console.log(`[scraper] Açılıyor: ${pageUrl}`);
  const browser = await puppeteer.launch(launchOptions());

  try {
    const m3u8 = await new Promise(async (resolve, reject) => {
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({
        "Accept-Language": "tr-TR,tr;q=0.9",
        Referer: CONFIG.BASE_URL + "/",
        Origin: CONFIG.BASE_URL,
      });

      await page.setRequestInterception(true);
      const BLOCK = new Set(["image", "font", "stylesheet"]);

      let resolved = false;
      const done = (v) => { if (!resolved) { resolved = true; clearTimeout(t); resolve(v); } };
      const fail = (e) => { if (!resolved) { resolved = true; clearTimeout(t); reject(e); } };

      const t = setTimeout(() => fail(new Error(`Timeout: ${pageUrl}`)), CONFIG.TIMEOUT_MS);

      page.on("request", (req) => {
        if (BLOCK.has(req.resourceType())) { req.abort(); return; }
        const url = req.url();
        if (url.includes(".m3u8")) {
          console.log(`[scraper] M3U8 yakalandı: ${url}`);
          req.continue();
          done(url);
          return;
        }
        req.continue();
      });

      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });

        try {
          const iframeSrc = await page.evaluate(() => {
            const sels = [
              'iframe[src*="player"]', 'iframe[src*="embed"]',
              'iframe[src*="video"]', 'iframe[src*="izle"]',
              'div.player iframe', 'div#player iframe',
              '#video-player', 'iframe',
            ];
            for (const s of sels) {
              const el = document.querySelector(s);
              if (el && el.src && !el.src.startsWith("about")) return el.src;
            }
            return null;
          });

          if (iframeSrc) {
            console.log(`[scraper] iframe: ${iframeSrc}`);
            await page.goto(iframeSrc, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });
          }
        } catch (e) {
          console.warn("[scraper] iframe atlandı:", e.message);
        }

        await new Promise(r => setTimeout(r, 8000));
      } catch (e) { fail(e); }
    });

    cacheSet(m3u8Cache, pageUrl, m3u8);
    return m3u8;
  } finally {
    await browser.close();
  }
}

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

// Health
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), cacheSize: m3u8Cache.size });
});

// Manifest
app.get("/manifest.json", (req, res) => {
  res.json(JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8")));
});

// M3U8 Proxy — CDN'e doğru Referer/Origin header'larıyla istek yapar
app.get("/proxy/m3u8", (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "?url= gerekli" });

  console.log(`[proxy] ${url}`);

  try {
    const target = new URL(url);
    const options = {
      hostname: target.hostname,
      path: target.pathname + target.search,
      headers: {
        "Referer": "https://x.ag2m4.cfd/",
        "Origin": "https://x.ag2m4.cfd",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
      },
    };

    https.get(options, (proxyRes) => {
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "*");
      proxyRes.pipe(res);
    }).on("error", (e) => {
      console.error("[proxy] Hata:", e.message);
      res.status(500).json({ error: e.message });
    });
  } catch (e) {
    res.status(400).json({ error: "Geçersiz URL" });
  }
});

// Stream — Fusion'dan gelen istek
app.get("/stream/:type/:encodedId.json", async (req, res) => {
  const { type } = req.params;
  const id = decodeURIComponent(req.params.encodedId);
  console.log(`[stream] type=${type} id=${id}`);

  try {
    let dizipalUrl;

    if (id.startsWith("http")) {
      dizipalUrl = id;
    } else {
      const epMatch = id.match(/^(tt\d+):(\d+):(\d+)$/);
      if (epMatch) {
        dizipalUrl = await findDizipalUrl(epMatch[1], "series", epMatch[2], epMatch[3]);
      } else if (/^tt\d+$/.test(id)) {
        dizipalUrl = await findDizipalUrl(id, type, null, null);
      } else {
        console.warn(`[stream] Tanınmayan ID: ${id}`);
        return res.json({ streams: [] });
      }
    }

    console.log(`[stream] Dizipal URL: ${dizipalUrl}`);
    const m3u8Url = await scrapeM3U8(dizipalUrl);

    // M3U8'i proxy üzerinden sun
res.json({
  streams: [{
    url: m3u8Url,
    title: "Dizipal",
    name: "HLS · M3U8",
    description: "dizipal.im",
    behaviorHints: { bingeGroup: "dizipal" },
  }],
});
  } catch (err) {
    console.error("[stream] Hata:", err.message);
    res.json({ streams: [] });
  }
});

// Manuel scrape (test)
app.get("/scrape", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "?url= gerekli" });
  try {
    res.json({ success: true, m3u8: await scrapeM3U8(url) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cache temizle
app.post("/cache/clear", (req, res) => {
  const n = m3u8Cache.size + slugCache.size + titleCache.size;
  m3u8Cache.clear(); slugCache.clear(); titleCache.clear();
  res.json({ cleared: n });
});

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Fusion Dizipal Addon v1.0.5 -> http://0.0.0.0:${CONFIG.PORT}`);
});
