# Dizipal Fusion Addon
Dizipal içeriklerini Fusion Media Center (Stremio uyumlu) protokolü üzerinden sunan, Puppeteer tabanlı gelişmiş bir Home Assistant eklentisidir. Bu eklenti, web üzerindeki içerikleri dinamik olarak tarar, m3u8 bağlantılarını yakalar ve yerel ağınızda bir API/Manifest üzerinden servis eder.
## 🚀 Özellikler
 * **Dinamik Kazıma (Scraping):** puppeteer-extra ve stealth eklentisi ile bot engellerini aşarak en güncel linklere ulaşır.
 * **Dahili Stream Proxy:** Kaynak sitelerin Referer ve User-Agent kontrollerini aşmak için trafiği yerel eklenti üzerinden tüneller.
 * **Kaynak Optimizasyonu:** Gereksiz reklam, font ve analitik isteklerini engelleyerek CPU ve RAM kullanımını minimize eder.
 * **Gelişmiş Önbellek:** Film/Dizi isimlerini ve yayın linklerini akıllı bir cache mekanizmasıyla saklayarak hızlı yanıt verir.
 * **Tam Entegrasyon:** Home Assistant seçenekler (options) menüsü ile kolayca yapılandırılabilir.
## 🛠 Kurulum (Home Assistant)
 1. Home Assistant paneline gidin.
 2. **Ayarlar** > **Eklentiler** > **Eklenti Mağazası** bölümüne girin.
 3. Sağ üstteki üç noktadan **Depolar** (Repositories) seçeneğine tıklayın.
 4. Aşağıdaki depo URL'sini ekleyin:
   https://github.com/dzirambola/hassio-addons
 5. Listede **Dizipal** eklentisini bulun ve **Yükle** butonuna basın.
 6. Kurulum bittikten sonra **Başlat** butonuna tıklayarak eklentiyi çalıştırın.
## ⚙️ Yapılandırma
Eklenti ayarları (Configuration) sekmesinden aşağıdaki parametreleri özelleştirebilirsiniz:
| Seçenek | Açıklama | Varsayılan |
|---|---|---|
| base_url | İçeriklerin çekileceği güncel domain adresi. | https://dizipal.im |
| port | API'nin yerel ağda yayın yapacağı port. | 7860 |
| cache_ttl_hours | Yayın linklerinin bellekte tutulma süresi (saat). | 12 |
| omdb_api_key | Film/Dizi meta verileri için API anahtarı. | trilogy |
| headless | Tarayıcının arayüzsüz modda çalışması (Önerilen: true). | true |
> [!TIP]
> **Önemli:** trilogy anahtarı bazen yoğunluktan dolayı hata verebilir. Daha stabil bir deneyim için omdbapi.com adresinden ücretsiz bir API Key alarak ayarlara girmeniz tavsiye edilir.
> 
## 📺 Fusion / Stremio Entegrasyonu
Eklentiyi başlattıktan sonra, Stremio veya Fusion destekli medya oynatıcınıza eklemeniz gereken Manifest URL'si şöyledir:
http://<HOME_ASSISTANT_IP>:7860/manifest.json
*(Not: <HOME_ASSISTANT_IP> kısmını kendi cihazınızın yerel IP'si ile değiştirin, örneğin: http://192.168.1.50:7860/manifest.json)*
## ⚠️ Uyarı ve Feragatname
Bu eklenti sadece kişisel kullanım ve eğitim amaçlı geliştirilmiştir. İçeriklerin telif hakları ilgili platformlara aittir. Kullanıcılar, bu eklentiyi kullanırken yerel yasalarına uymakla yükümlüdür.

**Lisans:** MIT

