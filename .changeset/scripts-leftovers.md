---
"@domicile-desktop/dev-shell": patch
"@domicile-desktop/engine": patch
"@domicile-desktop/e2e-harness": patch
"@domicile-desktop/manganese": patch
"@domicile-desktop/sdk": patch
"@domicile-desktop/shell-simple": patch
"@domicile-desktop/site": patch
---

The last package-specific scripts leave `scripts/`: `dev-shell` becomes a package the shells' `start:dev` runs, docs media capture moves into the site, `update-engine-release.sh` and the IDL check into the engine, and `smoke-compositor.sh` into the e2e harness.
