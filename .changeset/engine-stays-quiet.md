---
"@domicile-desktop/engine": patch
"domicile": patch
---

The engine downloads only the components a page needs (Widevine, certificate revocation and transparency, origin trials, the autoplay list, hyphenation, Screen AI), never downloads Chrome's on-device AI models, never asks Google for the time or whether AI Mode is offered, and opens no connection to the search engine before a search.
