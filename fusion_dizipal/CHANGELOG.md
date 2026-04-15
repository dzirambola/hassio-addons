## [1.4.6] - 2026-04-15

### 🛡️ Stabilite & HAOS Uyumu
* **Fix:** HAOS üzerindeki yetki (root) sorunu Dockerfile güncellenerek çözüldü.
* **Fix:** Apple Player (AVPlayer) için CORS ve Range başlıkları desteği eklendi.
* **Fix:** Proxy sırasında oluşan çökme (Headers Sent) hatası giderildi.
* **Fix:** Çoklu isteklerde tarayıcı kilidi (Race Condition) stabilize edildi.
* **Add:** 15sn Proxy Timeout mekanizması eklendi.

### 🛡️ Enterprise Stabilite İyileştirmeleri
* **Feature:** HAOS konteyner kapanmalarında zombi Chromium süreçlerini engelleyen Graceful Shutdown eklendi (SIGINT/SIGTERM yakalama).
* **Feature:** V8 motoru bellek sızıntılarını (memory bloat) önlemek adına 12 saatte bir çalışan otomatik tarayıcı geri dönüşüm mekanizması entegre edildi.
* **Fix:** Hedef site yavaşlığında çakışmaları önlemek için `page.goto` işlemlerine genel zaman aşımı (`CONFIG.TIMEOUT_MS`) uyumluluğu getirildi.
* **Fix:** İstek iptallerinde proxy veri akış borusunun (`pRes.destroy()`) zorunlu olarak kapatılması sağlandı (Apple cihazlarda donma koruması).
* **Feature:** API veya sistem çökmelerinde oynatıcı arayüzünü HTML yanıtıyla kitlemeyen "Global Error Handler" (JSON fallback) mekanizması eklendi.

### 🛡️ Mikro Hata ve Edge Case Düzeltmeleri
* **Fix:** RAM optimizasyonu sırasında aktif scraping işlemlerinin kesintiye uğramasını önleyen açık sekme kontrolü eklendi (`pages.length > 1`).
* **Fix:** `/proxy-stream` üzerinde tekrarlayan oynatma (scrubbing) kaynaklı `MaxListenersExceededWarning` sızıntısı giderildi; dinleyiciler tekilleştirildi.
* **Fix:** Dinamik CDN mimarilerinden kaynaklı 403 Forbidden hatalarını engellemek adına Proxy `Origin` başlığı dinamik hale getirildi.
* **UX:** HAOS loglarında saatlerin kafa karıştırmaması için zaman damgası yerel formata (Europe/Istanbul) zorlandı.
