# Changelog

Bu projedeki tüm önemli değişiklikler bu dosyada belgelenecektir.


## [1.4.2] - 2026-04-14


### 🛠 Düzeltildi (Fixed)
* **Sayfa Yaşam Döngüsü Güvenliği:** `scrapeM3U8` fonksiyonuna `try...finally` bloğu eklendi. Bu sayede navigasyon hataları veya zaman aşımı durumlarında bile Puppeteer sayfasının (`page.close()`) kesinlikle kapatılması sağlanarak RAM sızıntısı engellendi.
* **Hata Yönetimi:** Navigasyon sırasında oluşan küçük hataların link yakalama sürecini tamamen bozması engellendi; hata olsa dahi m3u8 isteğinin gelmesi için beklemeye devam ediliyor.

## 🛠 Düzeltildi (Fixed)
* **Boş Yanıt (Scraping) Sorunu:** Home Assistant OS (HAOS) kısıtlı Docker ortamında Chromium'un sayfa içeriğini çekememesi sorunu, `SYS_ADMIN` yetkisi geri verilerek ve tarayıcı bayrakları (`--disable-gpu` vb.) optimize edilerek çözüldü.
* **CORS Önceliği:** CORS middleware tanımı Express rotalarından en başa çekilerek, Stremio ve Fusion istemcilerinin tüm uç noktalara (manifest, stream) sorunsuz erişmesi sağlandı.
* **Bellek ve Bağlantı Yönetimi:** İstemci yayından çıktığında veya videoyu ileri/geri sardığında kaynak sunucuya açık kalan bağlantıların (`Socket Hang`) otomatik olarak yok edilmesi sağlandı.
