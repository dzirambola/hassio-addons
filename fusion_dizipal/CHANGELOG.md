# Changelog

Bu projedeki tüm önemli değişiklikler bu dosyada belgelenecektir.


## [1.4.2] - 2026-04-14

### 🚀 Eklendi (Added)
* **Gelişmiş Loglama:** m3u8 linkinin ne kadar sürede yakalandığı (saniye cinsinden) ve OMDb üzerinden çözümlenen gerçek film/dizi isimleri loglara eklendi.
* **Log Temizliği:** Uygulama her başladığında veya güncellendiğinde terminaldeki eski oturum loglarını otomatik olarak temizleyen `console.clear()` mekanizması eklendi.

### 🛠 Düzeltildi (Fixed)
* **Sayfa Yaşam Döngüsü Güvenliği:** `scrapeM3U8` fonksiyonuna `try...finally` bloğu eklendi. Bu sayede navigasyon hataları veya zaman aşımı durumlarında bile Puppeteer sayfasının (`page.close()`) kesinlikle kapatılması sağlanarak RAM sızıntısı engellendi.
* **Hata Yönetimi:** Navigasyon sırasında oluşan küçük hataların link yakalama sürecini tamamen bozması engellendi; hata olsa dahi m3u8 isteğinin gelmesi için beklemeye devam ediliyor.

## 🛠 Düzeltildi (Fixed)
* **Boş Yanıt (Scraping) Sorunu:** Home Assistant OS (HAOS) kısıtlı Docker ortamında Chromium'un sayfa içeriğini çekememesi sorunu, `SYS_ADMIN` yetkisi geri verilerek ve tarayıcı bayrakları (`--disable-gpu` vb.) optimize edilerek çözüldü.
* **CORS Önceliği:** CORS middleware tanımı Express rotalarından en başa çekilerek, Stremio ve Fusion istemcilerinin tüm uç noktalara (manifest, stream) sorunsuz erişmesi sağlandı.
* **Bellek ve Bağlantı Yönetimi:** İstemci yayından çıktığında veya videoyu ileri/geri sardığında kaynak sunucuya açık kalan bağlantıların (`Socket Hang`) otomatik olarak yok edilmesi sağlandı.

### 🛠 Düzeltildi (Fixed)
* **Bellek Sızıntısı ve Ağ Optimizasyonu:** `/proxy-stream` rotasında istemci bağlantıyı kopardığında (video kapatıldığında veya ileri sarıldığında) arka plandaki proxy isteğinin (`pReq`) ve veri akışının (`pRes`) anında iptal edilmesi sağlandı. Bu sayede RAM ve ağ bant genişliği gereksiz yere tüketilmez.
* **Puppeteer Sayfa Kapatma Güvencesi:** `scrapeM3U8` fonksiyonuna `try...finally` bloğu eklendi. Navigasyon hatası veya zaman aşımı olsa dahi sayfanın (`page.close()`) kesinlikle kapatılması garanti altına alındı.
* **CORS Önceliği:** CORS middleware'i en başa alınarak Stremio/Fusion erişim hataları giderildi.

### 🛡️ Güvenlik (Security)
* **SYS_ADMIN Yetkisi:** Home Assistant OS altında Chromium'un sayfa işleyebilmesi (scraping) için gerekli olan kernel yetenekleri kararlılık adına korunmuştur.

### 🛠 Düzeltildi (Fixed)
* **Proxy Kaynak Yönetimi:** İstemci yayından ayrıldığında proxy isteğiyle birlikte veri akışının da sonlandırılması sağlandı.
* **Sayfa Kapatma Güvencesi:** Puppeteer tarafında hata oluşsa bile sayfanın kapatılması garanti altına alınarak RAM kullanımı optimize edildi.
