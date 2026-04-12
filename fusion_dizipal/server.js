"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Fusion Media Center – Dizipal Scraper Addon
// server.js  |  Node.js + Express + Puppeteer-Extra + Stealth
//
// Endpoints:
//   GET /manifest.json              → Fusion addon manifest
//   GET /stream/:type/:id.json      → Stream (M3U8) resolver
//   GET /scrape?url=<dizipal-url>   → Raw scraper (debug / direct use)
//   GET /health                     → Health-check
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

// ── Configuration ─────────────────────────────────────────────────────────────
// Read from HAOS options file when running inside the addon,
// fall back to sensible defaults for local development.
function loadConfig() {
  const optionsPath = "/data/options.json"; // HAOS injects this file
  try {
    if (fs.existsSync(optionsPath)) {
      const raw = fs.readFileSync(optionsPath, "utf8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn("[config] Could not read HAOS options.json, using defaults:", e.message);
  }
  return {};
}

const opts = loadConfig();

const CONFIG = {
  // ── Easily update when dizipal rotates its domain ──
  BASE_URL: opts.base_url || process.env.DIZIPAL_BASE_URL || "https://dizipal.im",
  PORT: Number(opts.port || process.env.PORT || 7860),
  CACHE_TTL_MS: (Number(opts.cache_ttl_hours || 12)) * 60 * 60 * 1000,
  HEADLESS: opts.headless !== undefined ? opts.headless : true,
  TIMEOUT_MS: Number(opts.timeout_ms || 30000),
  // Path to Chromium installed by the Dockerfile
  CHROMIUM_PATH: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
};

console.log("[config]", {
  BASE_URL: CONFIG.BASE_URL,
  PORT: CONFIG.PORT,
  CACHE_TTL_MS: CONFIG.CACHE_TTL_MS,
  HEADLESS: CONFIG.HEADLESS,
  TIMEOUT_MS: CONFIG.TIMEOUT_MS,
  CHROMIUM_PATH: CONFIG.CHROMIUM_PATH,
});

// ── In-memory Cache ───────────────────────────────────────────────────────────
// Stores: { m3u8: string, fetchedAt: number }
// Key   : the dizipal page URL (normalised)
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CONFIG.CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.m3u8;
}

function cacheSet(key, m3u8) {
  cache.set(key, { m3u8, fetchedAt: Date.now() });
}

// ── Puppeteer: Launch options (ARM64 / Raspberry Pi optimised) ─────────────────
function buildLaunchOptions() {
  return {
    executablePath: CONFIG.CHROMIUM_PATH,
    headless: CONFIG.HEADLESS ? "new" : false,
    args: [
      "--no-sandbox",                     // Required inside Docker / HAOS
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",          // Avoids /dev/shm size issues on Pi
      "--disable-gpu",                    // No GPU inside container
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--no-first-run",
      "--no-zygote",                      // Helps on low-RAM devices
      "--single-process",                 // ⚠ Use if you still get crashes on Pi 3
      "--mute-audio",
      "--window-size=1280,720",
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/120.0.0.0 Safari/537.36",
    ],
    defaultViewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    timeout: CONFIG.TIMEOUT_MS,
  };
}

// ── Core Scraper ──────────────────────────────────────────────────────────────
/**
 * Launches Chromium, navigates to `pageUrl`, intercepts network requests,
 * and returns the first M3U8 URL found (or throws if none found in time).
 *
 * Strategy:
 *  1. Open page with request interception enabled.
 *  2. Block heavy assets (images, fonts, CSS) to speed things up.
 *  3. Wait for an iframe that likely contains the video player.
 *  4. Navigate the iframe src as well (some players load inside an iframe).
 *  5. Resolve as soon as a "master.m3u8" (or any .m3u8) request is detected.
 *  6. Hard timeout as safety net.
 *
 * @param {string} pageUrl  Full URL of the dizipal episode/movie page
 * @returns {Promise<string>} Resolved M3U8 URL
 */
async function scrapeM3U8(pageUrl) {
  // Return cached hit immediately
  const cached = cacheGet(pageUrl);
  if (cached) {
    console.log(`[scraper] Cache hit for ${pageUrl}`);
    return cached;
  }

  console.log(`[scraper] Launching browser for: ${pageUrl}`);
  const browser = await puppeteer.launch(buildLaunchOptions());

  try {
    const m3u8 = await new Promise(async (resolve, reject) => {
      const page = await browser.newPage();

      // ── Extra stealth headers ──────────────────────────────────────────
      await page.setExtraHTTPHeaders({
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        Referer: CONFIG.BASE_URL + "/",
        Origin: CONFIG.BASE_URL,
      });

      // ── Request interception ───────────────────────────────────────────
      await page.setRequestInterception(true);

      const BLOCK_TYPES = new Set(["image", "font", "stylesheet", "media"]);

      page.on("request", (req) => {
        // Block heavy resources to speed up scraping
        if (BLOCK_TYPES.has(req.resourceType())) {
          req.abort();
          return;
        }

        const url = req.url();

        // ── Detect M3U8 ─────────────────────────────────────────────────
        // Match "master.m3u8" first (highest quality playlist),
        // then fall back to any .m3u8 URL.
        if (url.includes(".m3u8")) {
          console.log(`[scraper] M3U8 intercepted: ${url}`);
          req.continue(); // Let the request proceed normally
          resolve(url);
          return;
        }

        req.continue();
      });

      // Safety: reject after timeout
      const timer = setTimeout(() => {
        reject(new Error(`Timeout: No M3U8 found within ${CONFIG.TIMEOUT_MS}ms for ${pageUrl}`));
      }, CONFIG.TIMEOUT_MS);

      // Clean up timer on resolve
      const originalResolve = resolve;
      resolve = (val) => {
        clearTimeout(timer);
        originalResolve(val);
      };

      try {
        // ── Navigate to the episode/movie page ──────────────────────────
        await page.goto(pageUrl, {
          waitUntil: "domcontentloaded",
          timeout: CONFIG.TIMEOUT_MS,
        });

        // ── Try to find and navigate the embedded player iframe ─────────
        // Dizipal typically wraps the video in an <iframe> with an
        // external player URL. We navigate to that URL as well so
        // Chromium fires the actual video segment requests.
        try {
          const iframeSrc = await page.evaluate(() => {
            // Common selectors for player iframes
            const selectors = [
              'iframe[src*="player"]',
              'iframe[src*="embed"]',
              'iframe[src*="video"]',
              'iframe[src*="izle"]',
              'iframe#video-player',
              'div.player-container iframe',
              'div#player iframe',
              'iframe',                 // last-resort fallback
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && el.src) return el.src;
            }
            return null;
          });

          if (iframeSrc) {
            console.log(`[scraper] Found iframe src: ${iframeSrc}`);
            // Open iframe URL in the same page to capture its network traffic
            await page.goto(iframeSrc, {
              waitUntil: "domcontentloaded",
              timeout: CONFIG.TIMEOUT_MS,
            });
          }
        } catch (iframeErr) {
          // Non-fatal – main page interception may still catch the M3U8
          console.warn("[scraper] iframe navigation skipped:", iframeErr.message);
        }

        // ── Wait a bit for any deferred JS to trigger video load ─────────
        await page.waitForTimeout(5000);

        // If we reach here without resolving, the timer will fire eventually.
      } catch (navErr) {
        clearTimeout(timer);
        reject(navErr);
      }
    });

    // Store in cache before returning
    cacheSet(pageUrl, m3u8);
    return m3u8;
  } finally {
    await browser.close();
  }
}

// ── URL Builders ──────────────────────────────────────────────────────────────
/**
 * Converts a Fusion stream request (type + id) into a dizipal.im page URL.
 *
 * Supported ID formats:
 *   - IMDb style   : "tt1234567"           → /dizi/tt1234567  or /film/tt1234567
 *   - Episode      : "tt1234567:1:3"       → /bolum/tt1234567-s01e03
 *   - Dizipal slug : "dizipal:show-name:1:3"
 *   - Raw URL      : already starts with http
 */
function buildDizipalUrl(type, id) {
  // Already a full URL (e.g., passed via /scrape endpoint)
  if (id.startsWith("http")) return id;

  const base = CONFIG.BASE_URL;

  // Episode format: tt1234567:season:episode
  const episodeMatch = id.match(/^(tt\d+):(\d+):(\d+)$/);
  if (episodeMatch) {
    const [, imdbId, season, episode] = episodeMatch;
    const s = String(season).padStart(2, "0");
    const e = String(episode).padStart(2, "0");
    return `${base}/bolum/${imdbId}-s${s}e${e}`;
  }

  // Dizipal-native slug: dizipal:show-slug:season:episode
  const dizipalEpMatch = id.match(/^dizipal:(.+):(\d+):(\d+)$/);
  if (dizipalEpMatch) {
    const [, slug, season, episode] = dizipalEpMatch;
    const s = String(season).padStart(2, "0");
    const e = String(episode).padStart(2, "0");
    return `${base}/bolum/${slug}-s${s}e${e}`;
  }

  // Movie or bare series ID
  if (type === "series") {
    return `${base}/dizi/${id}`;
  }

  return `${base}/film/${id}`;
}

// ── Express App ───────────────────────────────────────────────────────────────
const app = express();

// Allow Fusion (and browsers) to reach the addon from any origin
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.use(express.json());

// ── /health ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    cacheSize: cache.size,
    config: {
      BASE_URL: CONFIG.BASE_URL,
      CACHE_TTL_MS: CONFIG.CACHE_TTL_MS,
    },
  });
});

// ── /manifest.json ────────────────────────────────────────────────────────────
app.get("/manifest.json", (req, res) => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8")
  );
  res.json(manifest);
});

// ── /stream/:type/:id.json  (Fusion protocol endpoint) ───────────────────────
// Examples:
//   /stream/movie/tt0000001.json
//   /stream/series/tt0000002:1:3.json
app.get("/stream/:type/:encodedId.json", async (req, res) => {
  const { type, encodedId } = req.params;
  // Express captures the param before ".json"; decode %3A → ":"
  const id = decodeURIComponent(encodedId);

  console.log(`[stream] type=${type} id=${id}`);

  try {
    const dizipalUrl = buildDizipalUrl(type, id);
    console.log(`[stream] → dizipal URL: ${dizipalUrl}`);

    const m3u8Url = await scrapeM3U8(dizipalUrl);

    res.json({
      streams: [
        {
          url: m3u8Url,
          title: "Dizipal",
          name: "M3U8 · HLS",
          description: `Kaynak: ${CONFIG.BASE_URL}`,
          behaviorHints: {
            bingeGroup: "dizipal",
          },
        },
      ],
    });
  } catch (err) {
    console.error("[stream] Error:", err.message);
    // Fusion expects an empty array, not an HTTP error, when no stream is found
    res.json({ streams: [] });
  }
});

// ── /scrape?url=<URL>  (debug / direct use) ───────────────────────────────────
// Lets you test the scraper directly from a browser or curl:
//   curl "http://localhost:7860/scrape?url=https://dizipal.im/bolum/..."
app.get("/scrape", async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Missing ?url= parameter" });
  }

  console.log(`[scrape] Manual scrape request: ${url}`);

  try {
    const m3u8Url = await scrapeM3U8(url);
    res.json({ success: true, m3u8: m3u8Url });
  } catch (err) {
    console.error("[scrape] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── /cache/clear  (admin helper) ─────────────────────────────────────────────
app.post("/cache/clear", (req, res) => {
  const size = cache.size;
  cache.clear();
  res.json({ cleared: size });
});

// ── 404 catch-all ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Fusion Dizipal Addon running on http://0.0.0.0:${CONFIG.PORT}`);
  console.log(`   Manifest : http://0.0.0.0:${CONFIG.PORT}/manifest.json`);
  console.log(`   Health   : http://0.0.0.0:${CONFIG.PORT}/health`);
  console.log(`   Scrape   : http://0.0.0.0:${CONFIG.PORT}/scrape?url=<dizipal-url>\n`);
});
