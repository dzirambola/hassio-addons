"use strict";
/**
 * Fusion Dizipal Addon - v1.4.5
 * Özellik: Dinamik Çözünürlük Etiketleme (4K/1080p/720p), Dinamik IP ve Gelişmiş Scraper
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
  VERSION: "1.4.5",
  BASE_URL: opts.base_url || "https://dizipal826.com", 
  ADDON_URL: opts.addon_url ? opts.addon_url.replace(/\/$/, "") : null,
  PORT: Number(opts.port || 7860),
  TIMEOUT_MS: 50000,
  CHROMIUM_PATH: "/usr/bin/chromium",
  UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  LOGO_URL: "https://raw.githubusercontent.com/dzirambola/fusion-dizipal-addon/main/fusion_dizipal/image_0.png"
};

const app = express();
let CURRENT_DOMAIN = CONFIG.BASE_URL;

// ── 2. Çözünürlük Analiz Edici (Dinamik Etiketleme) ───────────────────────────
async function getVideoQuality(m3u8Url) {
  return new Promise((resolve) => {
    const protocol = m3u8Url.startsWith('https') ? https : http;
    protocol.get(m3u8Url, { headers: { "User-Agent": CONFIG.UA, "Referer": CURRENT_DOMAIN + "/" } }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        if (data.includes("RESOLUTION=")) {
          if (data.includes("3840x2160")) resolve("4K");
          if (data.includes("1920x1080")) resolve("1080p");
          if (data.includes("1280x720")) resolve("720p");
          if (data.includes("854x480")) resolve("480p");
        }
        resolve("HD"); // Tespit edilemezse varsayılan
      });
    }).on("error", () => resolve("1080p"));
  });
}

// ── 3. Scraper & Yardımcılar ─────────────────────────────────────────────────
async function scrapeM3U8(pageUrl) {
  const browser = await puppeteer.launch({
    executablePath: CONFIG.CHROMIUM_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--single-process"]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.UA);
    await page.setExtraHTTPHeaders({ "Referer": CURRENT_DOMAIN + "/" });
    
    return await new Promise(async (resolve, reject) => {
      const t = setTimeout(() => reject(new Error("M3U8 bulunamadı")), CONFIG.TIMEOUT_MS);
      page.on("request", (req) => {
        const url = req.url();
        if (url.includes(".m3u8") && !url.includes("ads")) {
          clearTimeout(t);
          resolve(url);
        }
      });
      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });
        const iframe = await page.evaluate(() => document.querySelector('iframe[src*="player"], iframe[src*="embed"], iframe[src*="vido"]')?.src);
        if (iframe) await page.goto(iframe, { waitUntil: "domcontentloaded" });
        await new Promise(r => setTimeout(r, 12000));
      } catch (e) {}
    });
  } finally { await browser.close(); }
}

function toSlug(title) {
  return title.toLowerCase().replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s").replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c").replace(/[^a-z0-9\s-]/g,"").trim().replace(/\s+/g,"-");
}

// ── 4. Proxy ───────────────────────────────────────────────────────────────────
app.get("/proxy-stream", (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.sendStatus(400);
  const options = { headers: { "User-Agent": CONFIG.UA, "Referer": CURRENT_DOMAIN + "/", "Origin": CURRENT_DOMAIN } };
  const protocol = targetUrl.startsWith('https') ? https : http;
  const pReq = protocol.get(targetUrl, options, (pRes) => {
    res.writeHead(pRes.statusCode, pRes.headers);
    pRes.pipe(res);
  });
  pReq.on('error', () => res.sendStatus(500));
});

// ── 5. Stream API ─────────────────────────────────────────────────────────────
app.get("/stream/:type/:id.json", async (req, res) => {
  const { id } = req.params;
  const cleanId = id.replace(".json", "");
  const publicBaseUrl = CONFIG.ADDON_URL || `http://${req.get('host')}`;

  try {
    const epMatch = cleanId.match(/^(tt\d+):(\d+):(\d+)$/);
    const imdbId = epMatch ? epMatch[1] : cleanId;
    
    // OMDb Başlık Çekme
    const title = await new Promise(resolve => {
        https.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=trilogy`, r => {
            let d = ""; r.on("data", c => d += c);
            r.on("end", () => { try { resolve(JSON.parse(d).Title); } catch(e) { resolve(null); } });
        }).on("error", () => resolve(null));
    });

    const dizipalUrl = epMatch ? `${CURRENT_DOMAIN}/bolum/${toSlug(title)}-${epMatch[2]}-sezon-${epMatch[3]}-bolum-izle/` : `${CURRENT_DOMAIN}/${toSlug(title)}/`;
    const m3u8 = await scrapeM3U8(dizipalUrl);
    
    // Dinamik Etiketleme: Gerçek kaliteyi kontrol et
    const quality = await getVideoQuality(m3u8);
    const streamTitle = epMatch ? `${title} S${epMatch[2].padStart(2,'0')}E${epMatch[3].padStart(2,'0')} · ${quality}` : `${title} · ${quality}`;

    res.json({
      streams: [{
        name: "Dizipal",
        title: streamTitle,
        url: `${publicBaseUrl}/proxy-stream?url=${encodeURIComponent(m3u8)}`,
        behaviorHints: { notWebReady: true }
      }]
    });
  } catch (err) { res.json({ streams: [] }); }
});

app.get("/manifest.json", (req, res) => {
  res.json({ id: "fusion.dizipal.clean", name: "Dizipal", version: CONFIG.VERSION, logo: CONFIG.LOGO_URL, resources: ["stream"], types: ["movie", "series"], idPrefixes: ["tt"] });
});

app.get("/health", (req, res) => res.json({ status: "OK", domain: CURRENT_DOMAIN, version: CONFIG.VERSION }));

app.listen(CONFIG.PORT, "0.0.0.0");
