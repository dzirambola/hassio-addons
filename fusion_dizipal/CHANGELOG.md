# Changelog

Bu projedeki tüm önemli değişiklikler bu dosyada belgelenecektir.


## [1.4.2] - 2026-04-14

## 🛠 Düzeltildi (Fixed)
* **Boş Yanıt (Scraping) Sorunu:** Home Assistant OS (HAOS) kısıtlı Docker ortamında Chromium'un sayfa içeriğini çekememesi sorunu, `SYS_ADMIN` yetkisi geri verilerek ve tarayıcı bayrakları (`--disable-gpu` vb.) optimize edilerek çözüldü.
* **CORS Önceliği:** CORS middleware tanımı Express rotalarından en başa çekilerek, Stremio ve Fusion istemcilerinin tüm uç noktalara (manifest, stream) sorunsuz erişmesi sağlandı.
* **Bellek ve Bağlantı Yönetimi:** İstemci yayından çıktığında veya videoyu ileri/geri sardığında kaynak sunucuya açık kalan bağlantıların (`Socket Hang`) otomatik olarak yok edilmesi sağlandı.
