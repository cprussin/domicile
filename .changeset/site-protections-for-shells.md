---
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/app-settings": minor
"domicile": minor
---

Each protection beside a page's ad blocking, hiding device details and removing tracking from links, turns on or off for the page's site or its window with a `<webview>`'s `setPrivacyProtection(name, on, "site" | "window")`, and reads back with `privacyProtections()` and `privacyProtectionsSetFor()`; every protection is off where ad blocking is. The engine's `site_privacy` lists a site's protections beside its mode and `set_site_privacy` takes `protections`, and Settings' Sites you changed lists and clears them.
