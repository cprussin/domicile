---
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/app-settings": minor
"domicile": minor
---

The engine hides cookie banners and blocks the scripts that show them, with the config's new `browser.cookie_banner_lists` (the EasyList Cookie List and uBlock Origin's cookie notices unless set), in each profile whose new `protections.hide_cookie_banners` is on, which it is unless set. A shield turns it on or off for a site or a window as `hideCookieBanners`, and Settings › Privacy has a switch for it.
