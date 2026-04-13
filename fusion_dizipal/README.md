# Dizipal Fusion Addon

Dizipal içeriklerini Fusion Media Center protokolü ile sunan Home Assistant eklentisi.

## Kurulum (Home Assistant)

1.  Home Assistant paneline gidin.
2.  **Ayarlar** > **Eklentiler** > **Eklenti Mağazası**'na girin.
3.  Sağ üstteki üç noktadan **Depolar**'ı (Repositories) seçin.
4.  Bu repo linkini ekleyin: `https://github.com/dzirambola/hassio-addons`
5.  Listede **Dizipal**'ı bulun ve kurun.
6.  Eklentiyi başlatın.

## Fusion / Stremio Entegrasyonu

Eklentiyi başlattıktan sonra, Fusion veya Stremio'ya eklemeniz gereken Manifest URL'si şudur:

`http://HOME_ASSISTANT_IP:7860/manifest.json`

*(Not: `HOME_ASSISTANT_IP` kısmını kendi Home Assistant cihazınızın IP'si ile değiştirin, örneğin `http://192.168.1.50:7860/manifest.json`)*
