"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const https = require("https");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

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
  CACHE_TTL_MS: (Number(opts.cache_ttl_hours || 12)) * 60 * 60 * 1000,
  TIMEOUT_MS: Number(opts.timeout_ms || 45000),
  CHROMIUM_PATH: "/usr/bin/chromium",
};
console.log("[config]", CONFIG);

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

function launchOptions() {
  return {
    executablePath: CONFIG.CHROMIUM_PATH,
    headless: "new",
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-gpu", "--disable-extensions", "--no-first-run", "--mute-audio",
      "--window-size=1280,720",
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ],
    defaultViewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    timeout: CONFIG.TIMEOUT_MS,
  };
}

// IMDb ID'den film/dizi adını al (ücretsiz OMDB)
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

function toQuery(title) {
  return encodeURIComponent(title.toLowerCase().replace(/[^\w\s]/g, " ").trim());
}

async function findShowUrl(query) {
  const browser = await puppeteer.launch(launchOptions());
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image","font","stylesheet","media"].includes(req.resourceType())) req.abort();
      else req.continue();
    });
    const searchUrl = `${CONFIG.BASE_URL}/?s=${query}`;
    console.log(`[slug] Arama: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });

    const showUrl = await page.evaluate((base) => {
      const sels = [".movies-list .ml-item a",".film-list .item a","article.poster a",".poster a","article a[href]","h2 a[href]","h3 a[href]"];
      for (const sel of sels) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (el.href && el.href.includes(base) && !el.href.includes("/?s=")) return el.href;
        }
      }
      // Fallback: tüm iç linkler
      for (const a of document.querySelectorAll("a[href]")) {
        const h = a.href;
        if (h && h.includes(base) && !h.includes("/?") && !h.includes("/page/") && !h.includes("/category/") && h !== base + "/") return h;
      }
      return null;
    }, CONFIG.BASE_URL);

    return showUrl;
  } finally {
    await browser.close();
  }
}

async function findEpisodeUrl(showUrl, season, episode) {
  const browser = await puppeteer.launch(launchOptions());
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image","font","stylesheet","media"].includes(req.resourceType())) req.abort();
      else req.continue();
    });
    await page.goto(showUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });
    const s = Number(season), e = Number(episode);
    const pad = (n) => String(n).padStart(2, "0");

    return await page.evaluate((s, e, base) => {
      const pad = (n) => String(n).padStart(2, "0");
      const patterns = [`${s}-sezon-${e}-bolum`,`sezon-${s}-bolum-${e}`,`s${pad(s)}e${pad(e)}`,`${s}x${pad(e)}`];
      for (const a of document.querySelectorAll("a[href]")) {
        const h = a.href.toLowerCase();
        if (!h.includes(base.toLowerCase())) continue;
        for (const pat of patterns) { if (h.includes(pat)) return a.href; }
      }
      return null;
    }, s, e, CONFIG.BASE_URL);
  } finally {
    await browser.close();
  }
}

async function findDizipalUrl(imdbId, type, season, episode) {
  const cacheKey = `${imdbId}:${season}:${episode}`;
  const cached = cacheGet(slugCache, cacheKey, CONFIG.CACHE_TTL_MS);
  if (cached) { console.log(`[slug] Cache: ${cached}`); return cached; }

  // 1) Başlık al
  const title = await fetchTitle(imdbId);
  if (!title) throw new Error(`IMDb başlığı alınamadı: ${imdbId}`);

  const query = toQuery(title);
  console.log(`[slug] "${title}" → query: ${query}`);

  // 2) Dizipal'de ara
  const showUrl = await findShowUrl(query);
  if (!showUrl) throw new Error(`Dizipal'de "${title}" bulunamadı`);
  console.log(`[slug] Show: ${showUrl}`);

  if (type === "movie" || !season || !episode) {
    cacheSet(slugCache, cacheKey, showUrl);
    return showUrl;
  }

  // 3) Bölüm URL'si bul
  const episodeUrl = await findEpisodeUrl(showUrl, season, episode);
  if (episodeUrl) {
    console.log(`[slug] Bölüm: ${episodeUrl}`);
    cacheSet(slugCache, cacheKey, episodeUrl);
    return episodeUrl;
  }

  // 4) Tahmin
  const slug = showUrl.replace(CONFIG.BASE_URL, "").replace(/\//g, "").trim();
  const guessUrl = `${CONFIG.BASE_URL}/bolum/${slug}-${season}-sezon-${episode}-bolum-izle/`;
  console.log(`[slug] Tahmin: ${guessUrl}`);
  cacheSet(slugCache, cacheKey, guessUrl);
  return guessUrl;
}

async function scrapeM3U8(pageUrl) {
  const cached = cacheGet(m3u8Cache, pageUrl, CONFIG.CACHE_TTL_MS);
  if (cached) { console.log(`[scraper] Cache: ${pageUrl}`); return cached; }

  console.log(`[scraper] Açılıyor: ${pageUrl}`);
  const browser = await puppeteer.launch(launchOptions());
  try {
    const m3u8 = await new Promise(async (resolve, reject) => {
      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({ "Accept-Language": "tr-TR,tr;q=0.9", Referer: CONFIG.BASE_URL + "/" });
      await page.setRequestInterception(true);
      const BLOCK = new Set(["image","font","stylesheet"]);
      let resolved = false;
      const done = (v) => { if (!resolved) { resolved=true; clearTimeout(t); resolve(v); } };
      const fail = (e) => { if (!resolved) { resolved=true; clearTimeout(t); reject(e); } };
      const t = setTimeout(() => fail(new Error(`Timeout: ${pageUrl}`)), CONFIG.TIMEOUT_MS);

      page.on("request", (req) => {
        if (BLOCK.has(req.resourceType())) { req.abort(); return; }
        const url = req.url();
        if (url.includes(".m3u8")) { console.log(`[scraper] M3U8: ${url}`); req.continue(); done(url); return; }
        req.continue();
      });

      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });
        try {
          const iframeSrc = await page.evaluate(() => {
            const sels = ['iframe[src*="player"]','iframe[src*="embed"]','iframe[src*="video"]','div.player iframe','iframe'];
            for (const s of sels) { const el = document.querySelector(s); if (el?.src && !el.src.startsWith("about")) return el.src; }
            return null;
          });
          if (iframeSrc) { console.log(`[scraper] iframe: ${iframeSrc}`); await page.goto(iframeSrc, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS }); }
        } catch (e) { console.warn("[scraper] iframe atlandı:", e.message); }
        await new Promise(r => setTimeout(r, 8000));
      } catch (e) { fail(e); }
    });
    cacheSet(m3u8Cache, pageUrl, m3u8);
    return m3u8;
  } finally {
    await browser.close();
  }
}

const app = express();
app.use((req, res, next) => { res.setHeader("Access-Control-Allow-Origin", "*"); next(); });

app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime(), cacheSize: m3u8Cache.size }));
app.get("/manifest.json", (req, res) => res.json(JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"))));

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
        return res.json({ streams: [] });
      }
    }
    console.log(`[stream] URL: ${dizipalUrl}`);
    const m3u8Url = await scrapeM3U8(dizipalUrl);
    res.json({ streams: [{ url: m3u8Url, title: "Dizipal", name: "HLS · M3U8", behaviorHints: { bingeGroup: "dizipal" } }] });
  } catch (err) {
    console.error("[stream] Hata:", err.message);
    res.json({ streams: [] });
  }
});

app.get("/scrape", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "?url= gerekli" });
  try { res.json({ success: true, m3u8: await scrapeM3U8(url) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post("/cache/clear", (req, res) => {
  const n = m3u8Cache.size + slugCache.size + titleCache.size;
  m3u8Cache.clear(); slugCache.clear(); titleCache.clear();
  res.json({ cleared: n });
});

app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.listen(CONFIG.PORT, "0.0.0.0", () => console.log(`\n🚀 Fusion Dizipal Addon -> http://0.0.0.0:${CONFIG.PORT}`));
