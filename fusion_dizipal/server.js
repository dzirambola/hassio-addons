"use strict";

const express = require("express");
const fs = require("fs");
const https = require("https");
const http = require("http");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const opts = (() => {
  try { return fs.existsSync("/data/options.json") ? JSON.parse(fs.readFileSync("/data/options.json", "utf8")) : {}; } catch (e) { return {}; }
})();

const CONFIG = {
  VERSION: "1.4.4",
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

// ── 1. Otomatik Domain Bulucu (Hata Anında) ──────────────────────────────────
async function refreshDomain() {
  console.log("[Auto-Domain] Hata algılandı veya boş sonuç döndü, güncel adres aranıyor...");
  const browser = await puppeteer.launch({
    executablePath: CONFIG.CHROMIUM_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--single-process"]
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(CONFIG.UA);
    await page.goto("https://www.google.com/search?q=dizipal+güncel+adres", { waitUntil: "networkidle2", timeout: 25000 });
    
    const detected = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'))
                         .map(a => a.href)
                         .filter(href => href.includes('dizipal') && !href.includes('google'));
      return links.length > 0 ? new URL(links[0]).origin : null;
    });

    if (detected && detected !== CURRENT_DOMAIN) {
      console.log(`[Auto-Domain] Yeni adres bulundu: ${detected}`);
      CURRENT_DOMAIN = detected;
      return true;
    }
  } catch (e) {
    console.error("[Auto-Domain] Arama hatası:", e.message);
  } finally {
    await browser.close();
  }
  return false;
}

// ── 2. Scraper (GELİŞMİŞ SÜRÜM) ──────────────────────────────────────────────
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
    
    // Ağ trafiğini izleyerek m3u8 yakala
    return await new Promise(async (resolve, reject) => {
      const t = setTimeout(() => reject(new Error("M3U8 yakalanamadı")), CONFIG.TIMEOUT_MS);
      
      page.on("request", (req) => {
        const url = req.url();
        // Reklam linklerini eleyip ana video linkine odaklanıyoruz
        if (url.includes(".m3u8") && !url.includes("ads") && !url.includes("pixel")) {
          clearTimeout(t);
          resolve(url);
        }
      });

      try {
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.TIMEOUT_MS });
        
        // Sitedeki olası tüm oynatıcı iframe'lerini bul ve içine "dokun"
        const frames = await page.frames();
        for (const frame of frames) {
            try {
                // Iframe'ler içinde bir etkileşim varmış gibi yaparak m3u8'i tetikle
                await frame.evaluate(() => {
                    const playBtn = document.querySelector('.vjs-big-play-button') || document.querySelector('#player');
                    if (playBtn) playBtn.click();
                });
            } catch (e) {}
        }

        // m3u8'in yüklenmesi için bekleme süresi
        await new Promise(r => setTimeout(r, 15000));
      } catch (e) {
        // Hata olsa bile request handler m3u8 yakalamış olabilir
      }
    });
  } finally {
    if (browser) await browser.close();
  }
}

// ── 3. Proxy & Stream API ─────────────────────────────────────────────────────
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

function toSlug(title) {
  return title.toLowerCase().replace(/ğ/g,"g").replace(/ü/g,"u").replace(/ş/g,"s").replace(/ı/g,"i").replace(/ö/g,"o").replace(/ç/g,"c").replace(/[^a-z0-9\s-]/g,"").trim().replace(/\s+/g,"-");
}

app.get("/stream/:type/:id.json", async (req, res) => {
  const { id } = req.params;
  const cleanId = id.replace(".json", "");
  const publicBaseUrl = CONFIG.ADDON_URL || `http://${req.get('host')}`;

  const fetchAndProcess = async (domain) => {
    const epMatch = cleanId.match(/^(tt\d+):(\d+):(\d+)$/);
    const imdbId = epMatch ? epMatch[1] : cleanId;
    
    // OMDb API
    const title = await new Promise(resolve => {
        https.get(`https://www.omdbapi.com/?i=${imdbId}&apikey=trilogy`, r => {
            let d = ""; r.on("data", c => d += c);
            r.on("end", () => { try { resolve(JSON.parse(d).Title); } catch(e) { resolve(null); } });
        }).on("error", () => resolve(null));
    });

    if (!title) throw new Error("Film/Dizi bulunamadı");
    
    const dizipalUrl = epMatch ? `${domain}/bolum/${toSlug(title)}-${epMatch[2]}-sezon-${epMatch[3]}-bolum-izle/` : `${domain}/${toSlug(title)}/`;
    const m3u8 = await scrapeM3U8(dizipalUrl);
    
    return {
      name: "Dizipal",
      title: epMatch ? `${title} S${epMatch[2].padStart(2,'0')}E${epMatch[3].padStart(2,'0')} · 1080p` : `${title} · 1080p`,
      url: `${publicBaseUrl}/proxy-stream?url=${encodeURIComponent(m3u8)}`,
      behaviorHints: { notWebReady: true }
    };
  };

  try {
    try {
      const stream = await fetchAndProcess(CURRENT_DOMAIN);
      res.json({ streams: [stream] });
    } catch (e) {
      console.log("[Hata] İlk deneme başarısız, domain yenileniyor...");
      await refreshDomain();
      const stream = await fetchAndProcess(CURRENT_DOMAIN);
      res.json({ streams: [stream] });
    }
  } catch (err) {
    res.json({ streams: [] });
  }
});

app.get("/manifest.json", (req, res) => {
  res.json({ id: "fusion.dizipal.clean", name: "Dizipal", version: CONFIG.VERSION, logo: CONFIG.LOGO_URL, resources: ["stream"], types: ["movie", "series"], idPrefixes: ["tt"] });
});

app.get("/health", (req, res) => res.json({ status: "OK", domain: CURRENT_DOMAIN, version: CONFIG.VERSION }));

app.listen(CONFIG.PORT, "0.0.0.0");
