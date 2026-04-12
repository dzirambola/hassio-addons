"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
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
  BASE_URL: opts.base_url || process.env.DIZIPAL_BASE_URL || "https://dizipal.im",
  PORT: Number(opts.port || process.env.PORT || 7860),
  CACHE_TTL_MS: (Number(opts.cache_ttl_hours || 12)) * 60 * 60 * 1000,
  HEADLESS: opts.headless !== undefined ? opts.headless : true,
  TIMEOUT_MS: Number(opts.timeout_ms || 45000),
  CHROMIUM_PATH: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
};

console.log("[config]", CONFIG);

// ── Cache ─────────────────────────────────────────────────────────────────────
const m3u8Cache = new Map();   // url → { m3u8, fetchedAt }
const slugCache = new Map();   // imdbId:season:episode → dizipalUrl

function cacheGet(map, key, ttl) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > ttl) { map.delete(key); return null; }
  return entry.value;
}

function cacheSet(map, key, value) {
  map.set(key, { value, fetchedAt: Date.now() });
}

// ── Puppeteer launch options ──────────────────────────────────────────────────
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

// ── Dizipal'de arama yaparak slug bul ────────────────────────────────────────
// IMDb ID + dizi adı ile Dizipal'in arama sayfasını açar,
// ilk sonucun linkini alır, sonra bölüm sayfasına yönlendirir.
async function findDizipalUrl(imdbId, type, season, episode) {
  const cacheKey = `${imdbId}:${season}:${episode}`;
  const cached = cacheGet(slugCache, cacheKey, CONFIG.CACHE_TTL_MS);
  if (cached) { console.log(`[slug] Cache hit: ${cached}`); return cached; }

  console.log(`[slug] Searching dizipal for imdb:${imdbId} s${season}e${episode}`);

  const browser = await puppeteer.launch(launchOptions());
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "Accept-Language": "tr-TR,tr;q=0.9" });

    // 1) Dizipal'in arama endpointi
    const searchUrl = `${CONFIG.BASE_URL}/?s=${imdbId}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });

    // 2) İlk arama sonucunun linkini al
    const showUrl = await page.evaluate(() => {
      const selectors = [
        "article.poster a",
        ".movies-list article a",
        ".film-list article a",
        "article a",
        ".search-result a",
        "h2.title a",
        "a.poster",
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.href) return el.href;
      }
      return null;
    });

    if (!showUrl) throw new Error(`Dizipal'de ${imdbId} bulunamadı`);
    console.log(`[slug] Show URL: ${showUrl}`);

    // 3) Dizi ise bölüm sayfasına git
    if (type === "series" && season && episode) {
      // Dizi sayfasını aç, bölüm linklerini listele
      await page.goto(showUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });

      const episodeUrl = await page.evaluate((s, e) => {
        const pad = (n) => String(n).padStart(2, "0");
        const allLinks = Array.from(document.querySelectorAll("a[href]"));

        // "1-sezon-1-bolum" veya "s01e01" formatını ara
        const patterns = [
          `${s}-sezon-${e}-bolum`,
          `sezon-${s}-bolum-${e}`,
          `s${pad(s)}e${pad(e)}`,
          `-${s}x${pad(e)}-`,
        ];

        for (const link of allLinks) {
          const href = link.href.toLowerCase();
          for (const pat of patterns) {
            if (href.includes(pat)) return link.href;
          }
        }
        return null;
      }, Number(season), Number(episode));

      if (episodeUrl) {
        console.log(`[slug] Episode URL: ${episodeUrl}`);
        cacheSet(slugCache, cacheKey, episodeUrl);
        return episodeUrl;
      }

      // Bölüm linki bulunamadıysa slug tahmin et
      const slug = showUrl.split("/").filter(Boolean).pop();
      const s = String(season).padStart(0, "");
      const e = String(episode).padStart(0, "");
      const guessUrl = `${CONFIG.BASE_URL}/bolum/${slug}-${s}-sezon-${e}-bolum-izle/`;
      console.log(`[slug] Guessing URL: ${guessUrl}`);
      cacheSet(slugCache, cacheKey, guessUrl);
      return guessUrl;
    }

    // Film ise direkt show URL döndür
    cacheSet(slugCache, imdbId, showUrl);
    return showUrl;

  } finally {
    await browser.close();
  }
}

// ── M3U8 yakala ───────────────────────────────────────────────────────────────
async function scrapeM3U8(pageUrl) {
  const cached = cacheGet(m3u8Cache, pageUrl, CONFIG.CACHE_TTL_MS);
  if (cached) { console.log(`[scraper] Cache hit: ${pageUrl}`); return cached; }

  console.log(`[scraper] Opening: ${pageUrl}`);
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
      const done = (val) => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(val); } };
      const fail = (err) => { if (!resolved) { resolved = true; clearTimeout(timer); reject(err); } };

      const timer = setTimeout(() => {
        fail(new Error(`Timeout: M3U8 bulunamadı (${CONFIG.TIMEOUT_MS}ms) - ${pageUrl}`));
      }, CONFIG.TIMEOUT_MS);

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

        // iframe src'yi bul ve aç
        try {
          const iframeSrc = await page.evaluate(() => {
            const sels = [
              'iframe[src*="player"]', 'iframe[src*="embed"]',
              'iframe[src*="video"]',  'iframe[src*="izle"]',
              'div.player iframe',     'div#player iframe',
              '#video-player',         'iframe',
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

        // JS'nin video yüklemesi için bekle
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

// Stream endpoint — Fusion'dan gelen istek
app.get("/stream/:type/:encodedId.json", async (req, res) => {
  const { type } = req.params;
  const id = decodeURIComponent(req.params.encodedId);
  console.log(`[stream] type=${type} id=${id}`);

  try {
    let dizipalUrl;

    // Eğer ID zaten bir URL ise direkt kullan
    if (id.startsWith("http")) {
      dizipalUrl = id;
    } else {
      // IMDb formatı: tt1234567 veya tt1234567:1:3
      const epMatch = id.match(/^(tt\d+):(\d+):(\d+)$/);
      if (epMatch) {
        const [, imdbId, season, episode] = epMatch;
        dizipalUrl = await findDizipalUrl(imdbId, "series", season, episode);
      } else {
        dizipalUrl = await findDizipalUrl(id, type, null, null);
      }
    }

    console.log(`[stream] Dizipal URL: ${dizipalUrl}`);
    const m3u8Url = await scrapeM3U8(dizipalUrl);

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
    const m3u8 = await scrapeM3U8(url);
    res.json({ success: true, m3u8 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cache temizle
app.post("/cache/clear", (req, res) => {
  const n = m3u8Cache.size + slugCache.size;
  m3u8Cache.clear(); slugCache.clear();
  res.json({ cleared: n });
});

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Fusion Dizipal Addon → http://0.0.0.0:${CONFIG.PORT}`);
});
