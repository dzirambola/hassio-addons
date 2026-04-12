# Fusion Dizipal Addon

Raspberry Pi üzerinde çalışan **Home Assistant OS (HAOS)** için Fusion Media Center eklentisi.  
`dizipal.im` sitesinden Puppeteer + Stealth ile M3U8 (HLS) video linklerini dinamik olarak yakalar ve Fusion protokolü üzerinden sunar.

---

## Mimari

```
Fusion App (iOS/tvOS/macOS)
        │
        │  GET /stream/series/tt1234567:1:3.json
        ▼
┌───────────────────────────┐
│  Express HTTP Server       │  ← Bu addon
│  (Node.js, port 7860)     │
│                           │
│  ┌─────────────────────┐  │
│  │  In-Memory Cache    │  │  12 saat TTL
│  └─────────────────────┘  │
│                           │
│  ┌─────────────────────┐  │
│  │  Puppeteer-Extra    │  │
│  │  + Stealth Plugin   │  │
│  │                     │  │
│  │  /usr/bin/chromium  │  │  ARM64 Chromium
│  └─────────────────────┘  │
└───────────────────────────┘
        │
        │  Headless Chromium → dizipal.im → iframe → M3U8
        ▼
   dizipal.im (CDN)
```

---

## Kurulum

### 1. Repo'yu Home Assistant'a Ekle

Home Assistant → Settings → Add-ons → Add-on Store → ⋮ → Repositories  
Adres olarak bu repo'nun URL'sini gir.

### 2. Addon'u Kur ve Başlat

"Fusion Dizipal" addon'unu bul → Install → Start

### 3. Fusion'da Ekle

Fusion uygulamasında **Settings → Addons → +** kısmına şu URL'yi gir:

```
http://<home-assistant-ip>:7860
```

---

## Yapılandırma (`config.yaml` options)

| Seçenek | Varsayılan | Açıklama |
|---|---|---|
| `base_url` | `https://dizipal.im` | Site domain değişince burası güncellenir |
| `port` | `7860` | HTTP port |
| `cache_ttl_hours` | `12` | Link önbellek süresi (saat) |
| `headless` | `true` | Chromium headless modu |
| `timeout_ms` | `30000` | Sayfa yükleme timeout (ms) |

---

## API Referansı

### `GET /manifest.json`
Fusion addon manifest dosyasını döndürür.

### `GET /stream/:type/:id.json`
Fusion stream endpoint. Örnekler:

```
GET /stream/movie/tt0000001.json
GET /stream/series/tt0000002:1:3.json
```

Yanıt:
```json
{
  "streams": [
    {
      "url": "https://cdn.example.com/hls/master.m3u8",
      "title": "Dizipal",
      "name": "M3U8 · HLS"
    }
  ]
}
```

### `GET /scrape?url=<tam-url>`
Ham scraper endpointi. Test amaçlı:

```bash
curl "http://localhost:7860/scrape?url=https://dizipal.im/bolum/..."
```

### `GET /health`
Sağlık kontrolü ve cache durumu.

### `POST /cache/clear`
Önbelleği temizler.

---

## ID Formatları

| İçerik | Format | Örnek |
|---|---|---|
| Film | `tt<imdbId>` | `tt0111161` |
| Dizi bölümü | `tt<imdbId>:<sezon>:<bölüm>` | `tt0903747:1:3` |
| Dizipal slug | `dizipal:<slug>:<sezon>:<bölüm>` | `dizipal:breaking-bad:1:3` |

---

## Domain Değişikliği

Site domain değiştirdiğinde sadece HAOS addon ayarlarından `base_url` alanını güncelle.  
Kod değişikliği gerekmez.

---

## Sorun Giderme

**"No M3U8 found" hatası**
- Dizipal player'ı değiştirmiş olabilir. `/scrape?url=` ile browser DevTools'da gördüğün iframe URL'sini test et.
- Timeout'u artır: `timeout_ms: 45000`

**Chromium çöküyor (Raspberry Pi 3)**
- `server.js` içindeki `--single-process` flag'ini aktif hale getir.
- Raspberry Pi 4/5 önerilir.

**Cloudflare engeli**
- Stealth plugin büyük ölçüde bunu aşar. Yine de sorun olursa `base_url`'in güncel olduğunu kontrol et.

---

## Geliştirme (Lokal)

```bash
# Bağımlılıkları kur
npm install

# Chromium yolunu ayarla (macOS örneği)
export CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Sunucuyu başlat
npm start

# Test
curl http://localhost:7860/health
curl "http://localhost:7860/scrape?url=https://dizipal.im/bolum/..."
```
