# Changelog

Bu projedeki tüm önemli değişiklikler bu dosyada belgelenecektir.

## [1.4.1] - 2026-04-14

Bu sürüm; altyapı modernizasyonu, Apple ekosistemi uyumluluğu ve sistem kararlılığına odaklanan kapsamlı bir güncellemedir.

### 🚀 Eklendi (Added)
* **Apple TV ve iPad Pro Desteği:** Dahili proxy rotasına (`/proxy-stream`) HTTP `Range` (byte-range) başlığı desteği eklendi. Bu sayede Apple cihazlarındaki katı medya oynatıcılarında videoyu ileri/geri sarma (seeking) sorunsuz hale getirildi.
* **Race Condition (Yarış Durumu) Kilidi:** Puppeteer'ın aynı anda gelen çoklu isteklerde birden fazla Chromium instance'ı açarak RAM'i tüketmesini engelleyen "Singleton Browser Lock" mekanizması eklendi.
* **Zombi Süreç Yönetimi:** Docker konteynerine `dumb-init` eklenerek, arka planda açık kalan yetim (orphan) Chromium süreçlerinin otomatik temizlenmesi sağlandı.

### 🔄 Değiştirildi (Changed)
* **İşletim Sistemi Tabanı:** Docker imajı `debian:bullseye-slim` sürümünden, daha modern kütüphanelere sahip olan `debian:bookworm-slim` sürümüne yükseltildi.
* **Node.js Sürümü:** Uygulama çalışma ortamı Node 18 LTS'den **Node 20 LTS** sürümüne taşınarak performans ve bellek yönetimi iyileştirildi.

### 🛠 Düzeltildi (Fixed)
* Ağ bağlantısı koptuğunda veya zaman aşımı oluştuğunda tarayıcının kilitli kalma sorunu giderildi.
* İstemci ve kaynak sunucu arasındaki başlık (header) senkronizasyonu iyileştirildi.

### 🛡️ Güvenlik (Security)
* **İzolasyon Katmanları:** Dockerfile içerisinde uygulama root olmayan (`pptruser`) bir kullanıcıya taşındı.
* **Home Assistant Uyumluluğu:** Home Assistant Supervisor'ın katı AppArmor ve Seccomp profilleriyle tam uyum sağlamak ve Chromium'un çökmesini engellemek adına `privileged: [SYS_ADMIN]` yetkisi (kontrollü olarak) korunmuştur.

---
*Not: Bu sürüm, 1.3.x serisindeki kararlılık sorunlarını gidermek için yayınlanmış ilk büyük sürümdür.*
