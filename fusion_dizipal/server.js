"use strict";
/**
 * Fusion Dizipal Addon - v1.4.2
 * Özellik: Hata durumunda otomatik domain güncelleme (Auto-Domain on Fail)
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
  VERSION: "1.4.2",
  BASE_URL: opts.base_url || "https://dizipal826.com", 
  PORT: Number(opts.port || 7860),
  TIMEOUT_MS: 50000,
  CHROMIUM_PATH: "/usr/bin/chromium",
  UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  LOGO_URL: "https://raw.githubusercontent.com/dzirambola/fusion-dizipal-addon/main/fusion_dizipal/image_0.png"
};

const app = express();
let CURRENT_DOMAIN = CONFIG.BASE_URL;

// Cache
const cache = new Map();
const cacheSet = (key, val) => cache.set(key, { v: val, t: Date.now() });
const cacheGet = (key, ttl) => {
  const e = cache.get(key);
  if (!e || (Date.now() - e.t > ttl)) return null;
  return e.v;
};

// ── 2. Otomatik Domain Bulucu (Sadece Hata Aldığında Tetiklenir) ─────────────
async function refreshDomain() {
  console.log("[Auto-Domain] Hata algılandı, güncel adres aranıyor...");
  const browser = await puppeteer.launch({
    executablePath: CONFIG.CHROMIUM_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--single-process"]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.UA);
    await page.goto("https://www.google.com/search?q=dizipal+güncel+adres", { waitUntil: "networkidle2", timeout: 20000 });
    
    const detected = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'))
                         .map(a => a.href)
                         .filter(href => href.includes('dizipal') && !href.includes('google'));
      return links.length > 0 ? new URL(links[0]).origin : null;
    });

    if (detected && detected !== CURRENT_DOMAIN) {
      console.log(`[Auto-Domain] Yeni adres onaylandı: ${detected}`);
      CURRENT_DOMAIN = detected;
      return true;
    }
  } catch (e) {
    console.error("[Auto-Domain] Arama sırasında hata:", e.message);
  } finally {
    await browser.close();
  }
  return false;
}

// ── 3. Yardımcı Fonksiyonlar ──────────────────────────────────────────────────
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

// ── 4. Scraper ────────────────────────────────────────────────────────────────
async function scrapeM3U8(pageUrl) {
  const browser = await puppeteer.launch({
    executablePath: CONFIG.CHROMIUM_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--single-process"]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.UA);
    await page.setExtraHTTPHeaders({ "Referer": CURRENT_DOMAIN + "/" });
    
    return await new Promise(async (resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Timeout")), CONFIG.TIMEOUT_MS);
      page.on("request", (req) => {
        if (req.url().includes(".m3u8")) { clearTimeout(t); resolve(req.url()); }
      });

      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });
        const iframe = await page.evaluate(() => document.querySelector('iframe[src*="player"], iframe[src*="embed"]')?.src);
        if (iframe) await page.goto(iframe, { waitUntil: "domcontentloaded" });
        await new Promise(r => setTimeout(r, 12000));
      } catch (e) {}
    });
  } finally {
    if (browser) await browser.close();
  }
}

// ── 5. Proxy ───────────────────────────────────────────────────────────────────
app.get("/proxy-stream", (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.sendStatus(400);
  const options = { headers: { "User-Agent": CONFIG.UA, "Referer": CURRENT_DOMAIN + "/", "Origin": CURRENT_DOMAIN } };
  const pReq = (targetUrl.startsWith('https') ? https : http).get(targetUrl, options, (pRes) => {
    res.writeHead(pRes.statusCode, pRes.headers);
    pRes.pipe(res);
  });
  pReq.on('error', () => res.sendStatus(500));
});

// ── 6. Stream API ─────────────────────────────────────────────────────────────
app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  const cleanId = id.replace(".json", "");

  const processRequest = async (domain) => {
    let title, dizipalUrl;
    const epMatch = cleanId.match(/^(tt\d+):(\d+):(\d+)$/);
    title = await fetchTitle(epMatch ? epMatch[1] : cleanId);
    
    if (epMatch) {
      dizipalUrl = `${domain}/bolum/${toSlug(title)}-${epMatch[2]}-sezon-${epMatch[3]}-bolum-izle/`;
    } else {
      dizipalUrl = `${domain}/${toSlug(title)}/`;
    }
    
    const m3u8 = await scrapeM3U8(dizipalUrl);
    return { m3u8, title: epMatch ? `${title} S${epMatch[2].padStart(2,'0')}E${epMatch[3].padStart(2,'0')} · 1080p` : `${title} · 1080p` };
  };

  try {
    // 1. Deneme (Mevcut Domain)
    try {
      const result = await processRequest(CURRENT_DOMAIN);
      return res.json({ streams: [{ name: "Dizipal", title: result.title, url: `http://192.168.2.145:7860/proxy-stream?url=${encodeURIComponent(result.m3u8)}`, behaviorHints: { notWebReady: true } }] });
    } catch (e) {
      // 2. Deneme (Hata aldık, yeni domain ara ve tekrar dene)
      const changed = await refreshDomain();
      if (changed) {
        const result = await processRequest(CURRENT_DOMAIN);
        return res.json({ streams: [{ name: "Dizipal", title: result.title, url: `http://192.168.2.145:7860/proxy-stream?url=${encodeURIComponent(result.m3u8)}`, behaviorHints: { notWebReady: true } }] });
      }
      throw e;
    }
  } catch (err) {
    res.json({ streams: [] });
  }
});

app.get("/manifest.json", (req, res) => {
  res.json({ id: "fusion.dizipal.clean", name: "Dizipal", version: CONFIG.VERSION, logo: CONFIG.LOGO_URL, resources: ["stream"], types: ["movie", "series"], idPrefixes: ["tt"] });
});

app.get("/health", (req, res) => res.json({ status: "OK", domain: CURRENT_DOMAIN, version: CONFIG.VERSION }));

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`Fusion v${CONFIG.VERSION} aktif: http://192.168.2.145:7860`);
});
