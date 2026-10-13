#!/usr/bin/env bash
# Lays out the `/usr` tree every distribution package is made from.
#
#   distro/stage.sh <binaries> <engine> <bun> <workspace> <stage>
#
# - <binaries>: the Rust binaries `flake.nix` installs, built by
#   `distro/binaries.sh`.
# - <engine>: the engine release, unpacked: the directory holding `chrome`.
# - <bun>: the bun binary the shell builder runs with. It also installs the
#   builder's modules.
# - <workspace>: a checkout after `distro/build.sh`'s workspace build.
# - <stage>: created; `<stage>/usr` is the tree.
#
# The layout is `domicilePackage`'s in `flake.nix` with `/usr` as the prefix,
# so `domicile` finds every part beside itself
# (docs/architecture/THE-DOMICILE-BINARY.md). Machine configuration (PAM,
# limits, AppArmor) differs by distribution and is in `distro/nfpm.yaml`.
set -euo pipefail

[ "$#" -eq 5 ] || {
  echo "usage: stage.sh <binaries> <engine> <bun> <workspace> <stage>" >&2
  exit 2
}
BINARIES="$1"
ENGINE="$2"
BUN="$3"
WORKSPACE="$4"
STAGE="$5"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mapfile -t PROGRAMS < <(grep -v '^#' "$ROOT/distro/programs")
SHELLS=(manganese simple splash)
APPS=(history)
APP_MODULES=(settings)

# What `domicile` resolves at run time, and where `PREFIX` puts it.
PREFIX=/usr
USR="$STAGE$PREFIX"
LIBEXEC="$USR/libexec/domicile"
ICONS="$PREFIX/share/domicile/icons"

# Fails naming `what` if `path` is missing.
need() { # path, what
  [ -e "$1" ] || {
    echo "stage.sh: no $2 at $1" >&2
    exit 1
  }
}

for program in "${PROGRAMS[@]}"; do
  need "$BINARIES/$program" "binary $program"
done
# The files `domicileEngine`'s install check requires.
for file in chrome libdomicile_engine.so; do
  need "$ENGINE/$file" "engine file $file"
done
for shell in "${SHELLS[@]}"; do
  need "$WORKSPACE/packages/shell-$shell/.vite/renderer/main_window/shell.js" \
    "built $shell shell"
done
for app in "${APPS[@]}"; do
  need "$WORKSPACE/packages/app-$app/.vite/extension/manifest.json" "built $app app"
done
for module in "${APP_MODULES[@]}"; do
  need "$WORKSPACE/packages/app-$module/.vite/app/$module.js" "built $module app"
done
need "$BUN" "bun"

rm -rf "$STAGE"
mkdir -p "$USR/bin" "$LIBEXEC/shells" "$LIBEXEC/apps" "$LIBEXEC/app-modules"

# Copies, not symlinks: `domicile` finds its siblings from `current_exe`.
for program in "${PROGRAMS[@]}"; do
  install -m 755 "$BINARIES/$program" "$USR/bin/$program"
done

# Unmodified. On a distribution, `libEGL.so.1` and the GSettings schemas are on
# the default paths, so the engine needs no wrapper, unlike in `flake.nix`.
cp -a "$ENGINE" "$LIBEXEC/engine"

install -m 755 "$BUN" "$LIBEXEC/bun"
install -m 755 "$ROOT/distro/builder" "$LIBEXEC/builder"

# What the builder needs, as in `shellWorkspace` in `flake.nix`.
"$ROOT/distro/shell-workspace.sh" modules "$BUN" "$WORKSPACE" "$LIBEXEC/workspace"
"$ROOT/distro/shell-workspace.sh" files "$BUN" "$WORKSPACE" "$LIBEXEC/workspace"

for shell in "${SHELLS[@]}"; do
  cp -a "$WORKSPACE/packages/shell-$shell/.vite/renderer/main_window" \
    "$LIBEXEC/shells/$shell"
done
for app in "${APPS[@]}"; do
  cp -a "$WORKSPACE/packages/app-$app/.vite/extension" "$LIBEXEC/apps/$app"
done
for module in "${APP_MODULES[@]}"; do
  cp -a "$WORKSPACE/packages/app-$module/.vite/app" "$LIBEXEC/app-modules/$module"
done

# Fills `@bin@`, `@icon@` and `@preview@` in a template from `nix/`, as
# `substitute` does in `flake.nix`.
fill() { # template, destination, icon name
  local icon="${3:-}"
  mkdir -p "$(dirname "$2")"
  sed -e "s|@bin@|$PREFIX/bin|g" \
    -e "s|@icon@|$ICONS/$icon.svg|g" \
    -e "s|@preview@|$ICONS/$icon-preview.svg|g" \
    "$1" >"$2"
}

fill "$ROOT/nix/domicile-session.desktop" "$USR/share/wayland-sessions/domicile.desktop"
fill "$ROOT/nix/domicile-open-url.desktop" "$USR/share/applications/domicile-open-url.desktop"
install -D -m 644 "$ROOT/nix/domicile-mimeapps.list" \
  "$USR/share/applications/domicile-mimeapps.list"

# The launcher's entries for Domicile's own programs.
mkdir -p "$STAGE$ICONS"
launcher() { # id, directory holding <id>.svg and <id>-preview.svg
  cp "$2/$1.svg" "$2/$1-preview.svg" "$STAGE$ICONS/"
  fill "$ROOT/nix/launcher/domicile-$1.desktop" \
    "$USR/share/applications/domicile-$1.desktop" "$1"
}
launcher history "$WORKSPACE/packages/app-history/icons"
launcher settings "$WORKSPACE/packages/app-settings/icons"
launcher screenshot "$ROOT/nix/launcher"
launcher shutdown "$ROOT/nix/launcher"
launcher reboot "$ROOT/nix/launcher"

install -D -m 644 "$ROOT/nix/domicile.portal" \
  "$USR/share/xdg-desktop-portal/portals/domicile.portal"
install -D -m 644 "$ROOT/nix/domicile-portals.conf" \
  "$USR/share/xdg-desktop-portal/domicile-portals.conf"
install -D -m 644 "$ROOT/nix/domicile-session.target" \
  "$USR/lib/systemd/user/domicile-session.target"
install -D -m 644 "$ROOT/nix/domicile-session-shutdown.target" \
  "$USR/lib/systemd/user/domicile-session-shutdown.target"
install -D -m 644 "$ROOT/distro/sysusers.conf" "$USR/lib/sysusers.d/domicile.conf"

install -D -m 644 "$ROOT/LICENSE" "$USR/share/doc/domicile/LICENSE"
install -D -m 644 "$ROOT/packages/domicile-engine/LICENSE.chromium" \
  "$USR/share/doc/domicile/LICENSE.chromium"
