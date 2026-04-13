FROM debian:bullseye-slim

LABEL maintainer="fusion-addon"
LABEL description="Fusion Media Center – Dizipal Scraper Addon (ARM64/AMD64)"

# ── Sistem Bağımlılıkları ve Tini ─────────────────────────────────────────────
# [span_0](start_span)Tini: Zombi süreçleri temizlemek için gerekli[span_0](end_span)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    tini \
    [span_1](start_span)&& curl -fsSL https://deb.nodesource.com/setup_18.x | bash -[span_1](end_span) \
    && apt-get install -y --no-install-recommends \
    nodejs \
    chromium \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    fonts-liberation \
    [span_2](start_span)fonts-noto[span_2](end_span) \
    && rm -rf /var/lib/apt/lists/*

# ── Kullanıcı Ayarları ────────────────────────────────────────────────────────
# Puppeteer için güvenli, düşük yetkili kullanıcı
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser \
    && chown -R pptruser:pptruser /home/pptruser

# ── Uygulama Katmanı ──────────────────────────────────────────────────────────
WORKDIR /app

# Sadece gerekli dosyaları kopyala
COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY manifest.json ./

# Yetkilendirme
RUN chown -R pptruser:pptruser /app

# ── Çalıştırma Ayarları ───────────────────────────────────────────────────────
USER pptruser

# Sağlık kontrolü
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    [span_3](start_span)CMD curl -sf http://localhost:7860/manifest.json || exit 1[span_3](end_span)

EXPOSE 7860

# Tini'yi giriş noktası olarak kullan (Sinyal yönetimi ve zombi temizliği için)
ENTRYPOINT ["/usr/bin/tini", "--"]

# Uygulamayı başlat
CMD ["node", "server.js"]
