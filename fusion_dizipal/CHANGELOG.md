# Changelog

Bu projedeki tüm önemli değişiklikler bu dosyada belgelenecektir.

## [1.4.0] - 2026-04-14

Bu sürüm, eklentinin mimarisini modernleştirmeye, Apple ekosistemindeki oynatma sorunlarını gidermeye ve altyapı performansını artırmaya odaklanan ilk büyük genel (public) sürümdür.

### 🚀 Eklendi (Added)
* **Apple TV ve iPad Pro Desteği:** Dahili proxy rotasına (`/proxy-stream`) HTTP `Range` (byte-range) başlığı desteği eklendi. Artık strict (katı) medya oynatıcılarında videoyu ileri/geri sarmak (seeking) çökmeye neden olmuyor.
* **Singleton Browser Kilidi (Race Condition Fix):** Puppeteer'ın aynı anda gelen çoklu isteklerde birden fazla Chromium sekmesi açarak RAM'i kilitlemesini önleyen kilit mekanizması eklendi. Tarayıcı sadece gerektiğinde tek bir instance olarak başlatılacak.
* **Gelişmiş Dokümantasyon:** Projenin mimarisini, çalışma mantığını ve yasal sınırlarını (Disclaimer) açıklayan detaylı bir `README.md` oluşturuldu.

### 🔄 Değiştirildi (Changed)
* **İşletim Sistemi Tabanı Güncellendi:** Docker imajı `debian:bullseye-slim` sürümünden, daha modern ve güncel kütüphanelere sahip `debian:bookworm-slim` sürümüne yükseltildi.
* **Node.js Sürümü Yükseltildi:** Uygulama altyapısı Node 18 LTS'den **Node 20 LTS** sürümüne taşındı. Bu sayede daha iyi bellek yönetimi ve performans sağlandı.

### 🛠 Düzeltildi (Fixed)
* **Home Assistant Supervisor Uyumluluğu:** Yeni Debian tabanına geçişte AppArmor ve `/data/options.json` erişim kısıtlamalarından kaynaklanan "boş sonuç" hatası giderildi. Chromium'un izole ortamda sorunsuz çalışabilmesi için gerekli `SYS_ADMIN` ayrıcalıkları korundu.
* Ağ bağlantısı koptuğunda veya istek zaman aşımına uğradığında arka planda açık kalan ve bellek sızıntısına (memory leak) yol açan yetim (orphan) Chromium süreçleri temizlendi.
