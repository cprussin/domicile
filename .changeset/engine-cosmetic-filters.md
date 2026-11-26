---
"@domicile-desktop/engine": minor
"domicile": minor
---

The engine hides what the filter lists name by a page's elements (`##.ad`,
`example.com##.promo`), with their exceptions and `$generichide`, in
Standard and Strict alike: the browser sends each website frame its site's
rules and the generic ones before it commits, and the renderer asks about the
page's classes and ids as they appear.
