"use strict";
// Fusion Dizipal Addon - v1.1.1 (Stream Proxy Enabled)

const express = require("express");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const opts = (() => {
  try { return fs.existsSync("/data/options.json") ? JSON.parse(fs.readFileSync("/data/options.json", "utf8")) : {}; } catch (e) { return {}; }
})();

const CONFIG = {
  BASE_URL: opts.base_url || "https://dizipal.im",
  PORT: Number(opts.port || 7860),
  TIMEOUT_MS: 45000,
  CHROMIUM_PATH: "/usr/bin/chromium",
  UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

const app = express();

// Manuel CORS (Apple TV için)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// --- Scraper & Helper Functions (Aynı Kalıyor) ---
async function scrapeM3U8(pageUrl) {
  const browser = await puppeteer.launch({
    executablePath: CONFIG.CHROMIUM_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--no-zygote"]
  });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "Referer": CONFIG.BASE_URL + "/" });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image", "font", "stylesheet"].includes(req.resourceType())) { req.abort(); }
      else { req.continue(); }
    });

    return await new Promise(async (resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Timeout")), CONFIG.TIMEOUT_MS);
      page.on("response", async (res) => {
        const url = res.url();
        if (url.includes(".m3u8")) {
          clearTimeout(t);
          resolve(url);
        }
      });
      await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
      const iframe = await page.evaluate(() => document.querySelector('iframe')?.src);
      if (iframe) await page.goto(iframe, { waitUntil: "domcontentloaded" });
      await new Promise(r => setTimeout(r, 6000));
    });
  } finally { await browser.close(); }
}

// ── PROXY ENDPOINT (Kritik Nokta) ─────────────────────────────────────────────
// Bu endpoint videoyu senin sunucun üzerinden tüneller
app.get("/proxy-stream", (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send("No URL");

  const parsedUrl = new URL(targetUrl);
  const options = {
    headers: {
      "User-Agent": CONFIG.UA,
      "Referer": CONFIG.BASE_URL + "/",
      "Origin": CONFIG.BASE_URL
    }
  };

  const proxyReq = (parsedUrl.protocol === 'https:' ? https : http).get(targetUrl, options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => res.status(500).send("Proxy Error"));
});

// ── STREAM HANDLER ───────────────────────────────────────────────────────────
app.get("/stream/:type/:id.json", async (req, res) => {
  try {
    const dizipalUrl = `${CONFIG.BASE_URL}/bolum/gassal-3-sezon-9-bolum-izle/`; // Test için sabit veya dinamik
    const rawM3u8 = await scrapeM3U8(dizipalUrl);
    
    // Kendi sunucunun adresini oluştur (IP:PORT üzerinden)
    // Örn: http://192.168.1.50:7860/proxy-stream?url=...
    const host = req.get('host'); 
    const proxiedUrl = `http://${host}/proxy-stream?url=${encodeURIComponent(rawM3u8)}`;

    res.json({
      streams: [{
        name: "Dizipal (Proxy)",
        title: "Apple TV Uyumlu Mod",
        url: proxiedUrl, // Doğrudan link değil, bizim proxy linkimiz
        behaviorHints: { notWebReady: false }
      }]
    });
  } catch (err) {
    res.json({ streams: [] });
  }
});

app.get("/manifest.json", (req, res) => {
  res.json({
    id: "fusion.dizipal.proxy",
    name: "Dizipal Proxy",
    description: "HA Apple TV Fix",
    version: "1.2.0",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
  });
});

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`🚀 Proxy Sunucu Hazır:111 ${CONFIG.PORT}`);
});
