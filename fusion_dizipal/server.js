"use strict";
/**
 * Fusion Dizipal Addon - v1.2.5
 * Home Assistant & Apple TV (Fusion/Infuse) Optimized
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

// ── 1. Yapılandırma ──────────────────────────────────────────────────────────
const opts = (() => {
  try {
    return fs.existsSync("/data/options.json") ? JSON.parse(fs.readFileSync("/data/options.json", "utf8")) : {};
  } catch (e) { return {}; }
})();

const CONFIG = {
  BASE_URL: opts.base_url || "https://dizipal.im",
  PORT: Number(opts.port || 7860),
  TIMEOUT_MS: 45000,
  CHROMIUM_PATH: "/usr/bin/chromium",
  UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
};

const app = express();

// ── 2. Manuel CORS & Pre-flight ──────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── 3. Stream Proxy (Vekil Sunucu) ───────────────────────────────────────────
// Apple TV'nin videoyu doğrudan çekemediği durumlarda trafiği tüneller
app.get("/proxy-stream", (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send("No URL");

  const parsedUrl = new URL(targetUrl);
  const options = {
    headers: {
      "User-Agent": CONFIG.UA,
      "Referer": CONFIG.BASE_URL + "/",
      "Origin": CONFIG.BASE_URL
    },
    timeout: 10000
  };

  const proxyReq = (parsedUrl.protocol === 'https:' ? https : http).get(targetUrl, options, (proxyRes) => {
    // Sunucudan gelen tüm başlıkları (Content-Type vb.) oynatıcıya ilet
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error("[Proxy Error]", err.message);
    res.status(500).send("Proxy Error");
  });
});

// ── 4. Puppeteer Scraper ─────────────────────────────────────────────────────
async function scrapeM3U8(pageUrl) {
  const browser = await puppeteer.launch({
    executablePath: CONFIG.CHROMIUM_PATH,
    headless: "new",
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--no-zygote", "--single-process", "--disable-gpu"
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.UA);
    await page.setExtraHTTPHeaders({ "Referer": CONFIG.BASE_URL + "/" });
    await page.setRequestInterception(true);

    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "font", "stylesheet", "media"].includes(type)) return req.abort();
      req.continue();
    });

    return await new Promise(async (resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Timeout")), CONFIG.TIMEOUT_MS);

      page.on("request", (req) => {
        const url = req.url();
        if (url.includes(".m3u8")) {
          clearTimeout(t);
          resolve(url);
        }
      });

      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
        // player/embed iframe'lerini tara
        const iframeSrc = await page.evaluate(() => {
          const el = document.querySelector('iframe[src*="player"], iframe[src*="embed"]');
          return el ? el.src : null;
        });
        if (iframeSrc) await page.goto(iframeSrc, { waitUntil: "domcontentloaded" });
        await new Promise(r => setTimeout(r, 8000));
      } catch (e) { /* Hata olsa da beklemeye devam et, m3u8 yakalanabilir */ }
    });
  } finally {
    await browser.close();
  }
}

// ── 5. Stremio/Fusion Stream Handler ──────────────────────────────────────────
app.get("/stream/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  const cleanId = id.replace(".json", "");

  try {
    // Burada URL çözümleme mantığı (ID -> Dizipal URL)
    let dizipalUrl = `${CONFIG.BASE_URL}/`; 
    // Örnek: Gassal dizisi için id'den URL üretme (Geliştirilebilir)
    if (cleanId.includes(":")) {
      const parts = cleanId.split(":");
      // Not: Slug üretme fonksiyonun buraya entegre edilebilir
      dizipalUrl += `bolum/gassal-${parts[1]}-sezon-${parts[2]}-bolum-izle/`;
    }

    const rawM3u8 = await scrapeM3U8(dizipalUrl);
    const host = req.get('host');
    
    // Apple TV için Proxy URL oluştur
    const proxiedUrl = `http://${host}/proxy-stream?url=${encodeURIComponent(rawM3u8)}`;

    res.json({
      streams: [{
        name: "Dizipal · Fusion",
        title: "⚡ Apple TV Hızlı Kanal\n(HLS Proxy)",
        url: proxiedUrl,
        behaviorHints: {
          notWebReady: true,
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
    console.error("[Stream Hata]", err.message);
    res.json({ streams: [] });
  }
});

// ── 6. Manifest ──────────────────────────────────────────────────────────────
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "fusion.dizipal.proxy",
    name: "Dizipal Proxy",
    description: "Home Assistant & Apple TV Optimized",
    version: "1.2.5",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
  });
});

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`🚀 Fusion Addon: v125 http://localhost:${CONFIG.PORT}`);
});
