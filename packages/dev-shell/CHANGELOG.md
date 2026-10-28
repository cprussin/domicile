# @domicile-desktop/dev-shell

## 0.0.2

### Patch Changes

- 3757596: Manganese ships its CSS prebuilt, and the shell builder runs no Panda step: it only transpiles and bundles. Style custom bar items with a CSS import.
- b1041f8: The last package-specific scripts leave `scripts/`: `dev-shell` becomes a package the shells' `start:dev` runs, docs media capture moves into the site, `update-engine-release.sh` and the IDL check into the engine, and `smoke-compositor.sh` into the e2e harness.
