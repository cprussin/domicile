---
"@domicile-desktop/distro": patch
"@domicile-desktop/ci": patch
"@domicile-desktop/engine": patch
---

`distro/` and `distro-checks` merge into `packages/distro`. Files every distribution installs (session, launchers, portal, systemd targets, D-Bus service) move from `nix/` to `share/`; `nix/` keeps only the Nix modules.
