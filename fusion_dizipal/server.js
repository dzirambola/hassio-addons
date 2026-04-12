"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
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
  BASE_URL: opts.base_url || process.env.DIZIPAL_BASE_URL || "https://dizipal.im",
  PORT: Number(opts.port || process.env.PORT || 7860),
  CACHE_TTL_MS: (Number(opts.cache_ttl_hours || 12)) * 60 * 60 * 1000,
  HEADLESS: opts.headless !== undefined ? opts.headless : true,
  TIMEOUT_MS: Number(opts.timeout_ms || 45000),
  CHROMIUM_PATH: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
};

console.log("[config]", CONFIG);

const m3u8Cache = new Map();
const slugCache = new Map();

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

async function findDizipalUrl(imdbId, type, season, episode) {
  const cacheKey = `${imdbId}:${season}:${episode}`;
  const cached = cacheGet(slugCache, cacheKey, CONFIG.CACHE_TTL_MS);
  if (cached) { console.log(`[slug] Cache hit: ${cached}`); return cached; }

  console.log(`[slug] Searching dizipal for imdb:${imdbId} s${season}e${episode}`);

  const browser = await puppeteer.launch(launchOptions());
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "Accept-Language": "tr-TR,tr;q=0.9" });

    const searchUrl = `${CONFIG.BASE_URL}/?s=${imdbId}`;
    await page.goto(searchUrl, { waitUntil: "dom
