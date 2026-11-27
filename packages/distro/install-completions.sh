#!/usr/bin/env bash
# Writes `domicile`'s tab completion where each shell looks for it, under
# <share>: install-completions.sh <domicile> <share>. `flake.nix` and
# `stage.sh` run it.
set -euo pipefail
domicile="$1"
share="$2"
mkdir -p "$share/bash-completion/completions" "$share/zsh/site-functions" \
  "$share/fish/vendor_completions.d" "$share/nushell/vendor/autoload"
"$domicile" completions bash >"$share/bash-completion/completions/domicile"
"$domicile" completions zsh >"$share/zsh/site-functions/_domicile"
"$domicile" completions fish >"$share/fish/vendor_completions.d/domicile.fish"
"$domicile" completions nushell >"$share/nushell/vendor/autoload/domicile.nu"
