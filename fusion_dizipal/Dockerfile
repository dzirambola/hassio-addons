FROM debian:bookworm-slim

LABEL maintainer="fusion-addon"
LABEL description="Dizipal Scraper Addon - Node 20 & Bookworm"

# Node.js 20 LTS + Chromium + Sistem kütüphaneleri
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
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
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Uygulama dizini
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

# Non-root kullanıcı ile güvenlik artırımı
RUN useradd -m pptruser && chown -R pptruser:pptruser /app
USER pptruser

EXPOSE 7860
CMD ["node", "server.js"]
