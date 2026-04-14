# Changelog

Bu projedeki tüm önemli değişiklikler bu dosyada belgelenecektir.

## [1.4.0] - 2026-04-14

Bu sürüm, eklentinin mimarisini modernleştirmeye, Apple ekosistemindeki oynatma sorunlarını gidermeye ve Home Assistant içindeki güvenlik standartlarını artırmaya odaklanan ilk büyük genel (public) sürümdür.

### 🚀 Eklendi (Added)
* **Apple TV ve iPad Pro Desteği:** Dahili proxy rotasına (`/proxy-stream`) HTTP `Range` (byte-range) başlığı desteği eklendi. Artık strict (katı) medya oynatıcılarında videoyu ileri/geri sarmak (seeking) çökmeye neden olmuyor.
* **Race Condition (Yarış Durumu) Kilidi:** Puppeteer'ın aynı anda gelen çoklu isteklerde (birden fazla Chromium sekmesi açarak) RAM'i kilitlemesini önleyen "Singleton Browser Lock" mekanizması eklendi.
* **Gelişmiş Dokümantasyon:** Projenin mimarisini, çalışma mantığını ve yasal sınırlarını (Disclaimer) açıklayan detaylı bir `README.md` oluşturuldu.

### 🔄 Değiştirildi (Changed)
* **İşletim Sistemi Tabanı Güncellendi:** Docker imajı `debian:bullseye-slim` sürümünden daha modern ve güncel kütüphanelere sahip `debian:bookworm-slim` sürümüne yükseltildi.
* **Node.js Sürümü Yükseltildi:** Uygulama altyapısı Node 18 LTS'den **Node 20 LTS** sürümüne taşındı, böylece daha iyi bellek yönetimi ve performans sağlandı.

### 🛠 Düzeltildi (Fixed)
* Ağ bağlantısı koptuğunda veya istek zaman aşımına uğradığında arka planda açık kalan ve bellek sızıntısına (memory leak) yol açan yetim Chromium süreçleri giderildi.

### 🛡️ Güvenlik (Security)
* **İzolasyon Artırıldı:** `config.yaml` dosyasından `privileged: [SYS_ADMIN]` gereksinimi kaldırıldı. Eklenti artık Home Assistant üzerinde sistem yetkileri talep etmeden tam izole (güvenli) bir şekilde çalışıyor.
* **Non-Root Kullanıcı:** Dockerfile içerisine `pptruser` adında yetkisiz bir kullanıcı eklendi. Container artık root yetkisiyle değil, sınırlı yetkilerle çalışarak olası güvenlik açıklarını minimize ediyor.
