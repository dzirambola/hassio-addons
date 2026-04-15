## [1.4.5] - 2026-04-15

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
