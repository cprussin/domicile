---
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/app-settings": minor
"domicile": minor
---

The engine blocks ads and trackers in every website's page, with adblock-rust and the config's `browser.block_lists` (EasyList, EasyPrivacy and uBlock Origin's filters unless set) plus the user's `browser.block_rules`. Each profile's `protections.block_ads_and_trackers` is `standard`, which blocks other sites' ads and trackers, `strict`, which blocks a site's own too and is a private profile's default, or `off`. Settings › Privacy chooses it per profile.
