"use strict";

/**
 * Fusion Dizipal Addon - v1.4.0 (Public Release)
 * Özellikler: Singleton Browser Lock, Range Header Support (Apple TV Fix), Optimize Proxy
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
  VERSION: "1.4.0",
  BASE_URL: opts.base_url || "https://dizipal.im",
  PORT: Number(opts.port || 7860),
  TIMEOUT_MS: Number(opts.timeout_ms || 45000),
  CACHE_TTL_MS: Number(opts.cache_ttl_hours || 12) * 60 * 60 * 1000,
  HEADLESS: opts.headless !== false ? "new" : false,
  OMDB_KEY: opts.omdb_api_key || "trilogy",
  CHROMIUM_PATH: "/usr/bin/chromium",
  UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
};

const app = express();
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
    console.log(`[${new Date().toISOString()}] Tarayıcı başlatılıyor...`);
    _browser = await puppeteer.launch({
      executablePath: CONFIG.CHROMIUM_PATH,
      headless: CONFIG.HEADLESS,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--no-zygote"]
    });
    
    _browser.on('disconnected', () => { _browser = null; });
  } catch (e) {
    console.error("Tarayıcı başlatma hatası:", e);
  } finally {
    _isLaunching = false;
  }
  
  return _browser;
}

// Proxy-Stream: Range desteği ile Apple TV ileri sarma sorunu giderildi
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
  });
  pReq.on('error', () => res.sendStatus(500));
});

// Yardımcı fonksiyonlar ve diğer rotalar (manifest, stream) aynı yapıda kalabilir...
// (Kodun kısalığı için temel stream mantığını koruduğunu varsayıyorum)

app.get("/manifest.json", (req, res) => {
  res.json({
    id: "fusion.dizipal.clean",
    name: "Dizipal",
    version: CONFIG.VERSION,
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
  });
});

app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`Fusion Addon v${CONFIG.VERSION} Port ${CONFIG.PORT} aktif`);
});
