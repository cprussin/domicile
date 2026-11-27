---
"@domicile-desktop/engine": patch
"domicile": patch
---

A container query that was unknown while its container had no size is evaluated again when the root font size or the viewport changes. Before, its cached result could go stale, and engine builds with expensive DCHECKs stopped on `container_query_evaluator.cc`'s unit flags check.
