---
"@domicile-desktop/ci": patch
"@domicile-desktop/site": patch
"@domicile-desktop/engine": patch
"domicile": patch
---

The engine's checks run it on flake.lock's glibc: `.#full` sets `NIX_LD`, and Chromium's nix-shell takes flake.lock's nixpkgs, not the host's flake registry.
