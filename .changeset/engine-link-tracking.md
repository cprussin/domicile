---
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/app-settings": minor
"@domicile-desktop/e2e-harness": patch
"domicile": minor
---

The engine takes the tracking out of a link from one site to another: in
Standard, click ids such as `fbclid`, `gclid` and `msclkid` (Brave's list);
in Strict, the `utm_` campaign parameters too. Off keeps everything. Each
profile's new `protections.remove_tracking_from_links`, on unless set
`false`, turns it off, and Settings › Privacy has its switch.
