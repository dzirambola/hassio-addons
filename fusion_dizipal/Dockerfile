FROM debian:bullseye-slim

# ── Metadata ──────────────────────────────────────────────────────────────────
LABEL maintainer="fusion-addon"
LABEL description="Fusion Media Center – Dizipal Scraper Addon (ARM64)"

# ── System dependencies ───────────────────────────────────────────────────────
# Chromium on Debian Bullseye pulls all required libs automatically.
# We add extra font & media packages for better rendering compatibility.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    # Core shared libs Chromium needs at runtime
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
    # Font packages – prevent blank-box rendering for Turkish characters
    fonts-liberation \
    fonts-noto \
    fonts-noto-cjk \
    # Network / TLS
    ca-certificates \
    # Node.js runtime
    nodejs \
    npm \
    # Utilities
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Upgrade npm to latest stable ──────────────────────────────────────────────
RUN npm install -g npm@latest

# ── Create non-root user (Chromium refuses to run as root without --no-sandbox)
# We still use --no-sandbox in the launch args, but running as non-root is
# better practice and avoids some Chromium security check failures.
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser

# ── App directory ─────────────────────────────────────────────────────────────
WORKDIR /app
COPY package.json ./

# Install Node deps as root first (writes to /app/node_modules)
RUN npm install --omit=dev

# Copy source
COPY server.js ./
COPY manifest.json ./

# Hand ownership over to pptruser
RUN chown -R pptruser:pptruser /app

USER pptruser

# ── Health-check ──────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:7860/manifest.json || exit 1

# ── Entrypoint ────────────────────────────────────────────────────────────────
EXPOSE 7860
CMD ["node", "server.js"]
