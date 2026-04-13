"use strict";
/**
 * Fusion Dizipal Addon - v1.4.0
 * Özellikler: Auto-Domain (Otomatik Adres Bulucu), Proxy, 1080p Etiketi
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
  VERSION: "1.4.0",
  BASE_URL: opts.base_url || "https://dizipal.im",
  PORT: Number(opts.port || 7860),
  TIMEOUT_MS: 45000,
  CHROMIUM_PATH: "/usr/bin/chromium",
  UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  LOGO_URL: "https://raw.githubusercontent.com/dzirambola/fusion-dizipal-addon/main/fusion_dizipal/image_0.png"
};

const app = express();
let CURRENT_DOMAIN = CONFIG.BASE_URL; // Dinamik domain değişkeni

// Cache Mekanizması
const cache = new Map();
const cacheSet = (key, val) => cache.set(key, { v: val, t: Date.now() });
const cacheGet = (key, ttl) => {
  const e = cache.get(key);
  if (!e || (Date.now() - e.t > ttl)) return null;
  return e.v;
};

// ── 2. Otomatik Domain Bulucu (Auto-Domain) ──────────────────────────────────
async function findLatestDomain() {
  console.log("[Auto-Domain] Güncel adres aranıyor...");
  const browser = await puppeteer.launch({
    executablePath: CONFIG.CHROMIUM_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.UA);
    // Google üzerinden en güncel Dizipal adresini aratır
    await page.goto("https://www.google.com/search?q=dizipal+güncel+adres", { waitUntil: "networkidle2" });
    
    const newDomain = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('cite')).map(el => el.innerText);
      const dizipalLink = links.find(l => l.includes('dizipal'));
      if (dizipalLink) {
        const url = dizipalLink.startsWith('http') ? dizipalLink : 'https://' + dizipalLink;
        return new URL(url).origin;
      }
      return null;
    });

    if (newDomain && newDomain !== CURRENT_DOMAIN) {
      console.log(`[Auto-Domain] Yeni adres bulundu: ${newDomain}`);
      CURRENT_DOMAIN = newDomain;
      return newDomain;
    }
    return CURRENT_DOMAIN;
  } catch (e) {
    console.error("[Auto-Domain] Arama başarısız:", e.message);
    return CURRENT_DOMAIN;
  } finally {
    await browser.close();
  }
}

// ── 3. Yardımcı Fonksiyonlar ────────────────────────────────────────────────────
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

// ── 4. Scraper (İyileştirilmiş) ──────────────────────────────────────────────
async function scrapeM3U8(pageUrl) {
  const cached = cacheGet(`m3u8:${pageUrl}`, 6 * 60 * 60 * 1000); // 6 saat cache
  if (cached) return cached;

  const browser = await puppeteer.launch({
    executablePath: CONFIG.CHROMIUM_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--single-process"]
  });

  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "Referer": CURRENT_DOMAIN + "/" });
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
        if (iframe) await page.goto(iframe, { waitUntil: "domcontentloaded" });
        await new Promise(r => setTimeout(r, 10000));
      } catch (e) {}
    });
  } finally {
    if (browser) await browser.close();
  }
}

// ── 5. Proxy ─────────────────────────────────────────────────────────────────────
app.get("/proxy-stream", (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.sendStatus(400);
  const options = { headers: { "User-Agent": CONFIG.UA, "Referer": CURRENT_DOMAIN + "/", "Origin": CURRENT_DOMAIN } };
  const pReq = (targetUrl.startsWith('https') ? https : http).get(targetUrl, options, (pRes) => {
    if (pRes.headers['content-type']) res.setHeader('Content-Type', pRes.headers['content-type']);
    res.writeHead(pRes.statusCode);
    pRes.pipe(res);
  });
  pReq.on('error', () => res.sendStatus(500));
});

// ── 6. Stremio/Fusion Routes ────────────────────────────────────────────────────
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

  try {
    let title, dizipalUrl, streamTitle;
    const epMatch = cleanId.match(/^(tt\d+):(\d+):(\d+)$/);

    if (epMatch) { 
      title = await fetchTitle(epMatch[1]);
      if (!title) throw new Error("Title bulunamadı");
      dizipalUrl = `${CURRENT_DOMAIN}/bolum/${toSlug(title)}-${epMatch[2]}-sezon-${epMatch[3]}-bolum-izle/`;
      streamTitle = `${title} S${epMatch[2].padStart(2, '0')}E${epMatch[3].padStart(2, '0')} · 1080p`;
    } else { 
      title = await fetchTitle(cleanId);
      if (!title) throw new Error("Title bulunamadı");
      dizipalUrl = `${CURRENT_DOMAIN}/${toSlug(title)}/`;
      streamTitle = `${title} · 1080p`;
    }

    // İlk denemede hata alırsak domain güncellemesi dene
    let rawM3u8;
    try {
      rawM3u8 = await scrapeM3U8(dizipalUrl);
    } catch (e) {
      await findLatestDomain(); // Domain güncelle
      dizipalUrl = dizipalUrl.replace(CONFIG.BASE_URL, CURRENT_DOMAIN); // Yeni domainle linki güncelle
      rawM3u8 = await scrapeM3U8(dizipalUrl);
    }

    const host = req.get('host');
    const proxiedUrl = `http://${host}/proxy-stream?url=${encodeURIComponent(rawM3u8)}`;

    res.json({
      streams: [{
        name: "Dizipal",
        title: streamTitle,
        url: proxiedUrl,
        behaviorHints: { 
            notWebReady: true,
            proxyHeaders: { request: { "User-Agent": CONFIG.UA, "Referer": CURRENT_DOMAIN + "/" } }
        }
      }]
    });
  } catch (err) {
    res.json({ streams: [] });
  }
});

app.get("/health", (req, res) => res.json({ status: "OK", domain: CURRENT_DOMAIN }));
app.use((req, res, next) => { res.setHeader("Access-Control-Allow-Origin", "*"); next(); });

app.listen(CONFIG.PORT, "0.0.0.0", async () => {
  console.log(`\nFusion Addon v${CONFIG.VERSION} çalışıyor`);
  await findLatestDomain(); // Başlangıçta güncel domaini kontrol et
});
