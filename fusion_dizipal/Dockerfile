# ── 1. Temel İmaj ───────────────────────────────────────────────────────────
FROM debian:bullseye-slim

LABEL maintainer="dzirambola"
LABEL description="Dizipal Fusion Scraper Addon - 1080p Optimized"

# ── 2. Bağımlılıkların Kurulumu ──────────────────────────────────────────────
# Node.js, Chromium ve Puppeteer için gerekli sistem kütüphaneleri
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
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
    fonts-noto \
    && rm -rf /var/lib/apt/lists/*

# ── 3. Uygulama Dizin Yapısı ────────────────────────────────────────────────
WORKDIR /app

# Sadece package.json kopyalayarak bağımlılıkları yükle (Docker cache avantajı)
COPY package.json .
RUN npm install --production

# Uygulama dosyalarını kopyala
COPY . .

# ── 4. Güvenlik ve İzinler ──────────────────────────────────────────────────
# Puppeteer'ın sandbox modunda sorunsuz çalışması için izinler
RUN chmod -R 777 /app

# ── 5. Sağlık Kontrolü (Healthcheck) ────────────────────────────────────────
# Eklentinin çalışıp çalışmadığını her 30 saniyede bir kontrol eder
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:7860/health || exit 1

# ── 6. Başlatma ─────────────────────────────────────────────────────────────
EXPOSE 7860

CMD ["node", "server.js"]
