#!/usr/bin/env bash
# Tests `distro/stage.sh`, which lays out the tree every distribution package
# is made from.
#
# `domicile` finds its parts from its own path (`../libexec/domicile`), so a
# file in the wrong place fails only when a desktop starts. This runs the
# script against stand-in inputs and checks each part is where `domicile`, the
# display manager, systemd and the portal look.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE_SH="$ROOT/distro/stage.sh"
[ -x "$STAGE_SH" ] || { echo "no $STAGE_SH" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}
expect() { # what, want, got
  if [ "$3" = "$2" ]; then
    ok "$1"
  else
    fail "$1" "wanted: $(printf '%q' "$2")  got: $(printf '%q' "$3")"
  fi
}
holds_line() { # what, file, line
  if [ -f "$2" ] && grep -qxF "$3" "$2"; then
    ok "$1"
  else
    fail "$1" "$2 has no line: $3"
  fi
}

# The binaries `flake.nix` copies into `bin/`, so the two packagings cannot
# drift apart.
FLAKE_BINARIES="$(grep -o 'cp ${domicileBinaries}/bin/[a-z-]*' "$ROOT/flake.nix" |
  sed 's|.*/bin/||' | sort -u)"

# ---- stand-in inputs -------------------------------------------------------

BINARIES="$WORK/binaries"
mkdir -p "$BINARIES"
for binary in $FLAKE_BINARIES; do
  printf '#!/bin/sh\necho %s\n' "$binary" >"$BINARIES/$binary"
  chmod +x "$BINARIES/$binary"
done

ENGINE="$WORK/engine"
mkdir -p "$ENGINE/locales"
touch "$ENGINE/chrome" "$ENGINE/libdomicile_engine.so" "$ENGINE/locales/en-US.pak"
chmod +x "$ENGINE/chrome"

# Prints its arguments, so the builder's command line can be read back.
BUN="$WORK/bun"
printf '#!/bin/sh\necho "$@"\n' >"$BUN"
chmod +x "$BUN"

WORKSPACE="$WORK/workspace"
page() { # package, file
  mkdir -p "$(dirname "$WORKSPACE/packages/$1/$2")"
  echo "$1" >"$WORKSPACE/packages/$1/$2"
  echo '{}' >"$WORKSPACE/packages/$1/package.json"
}
mkdir -p "$WORKSPACE/node_modules/.cache" "$WORKSPACE/node_modules/vite"
echo '{}' >"$WORKSPACE/package.json"
echo cached >"$WORKSPACE/node_modules/.cache/junk"
echo vite >"$WORKSPACE/node_modules/vite/index.js"
for shell in manganese simple splash; do
  page "shell-$shell" .vite/renderer/main_window/shell.js
done
for app in history settings; do
  page "app-$app" .vite/extension/manifest.json
  page "app-$app" "icons/$app.svg"
  page "app-$app" "icons/$app-preview.svg"
done
page domicile-builder src/main.ts
# A crate: no `package.json`, so not part of the workspace.
mkdir -p "$WORKSPACE/packages/domicile-launch/src"
touch "$WORKSPACE/packages/domicile-launch/Cargo.toml"

# ---- a complete stage ------------------------------------------------------

STAGE="$WORK/stage"
echo "a stage from complete inputs"
if out="$("$STAGE_SH" "$BINARIES" "$ENGINE" "$BUN" "$WORKSPACE" "$STAGE" 2>&1)"; then
  ok "stage.sh succeeds"
else
  fail "stage.sh succeeds" "$out"
fi

USR="$STAGE/usr"
LIBEXEC="$USR/libexec/domicile"

echo "domicile finds its parts beside itself"
for binary in $FLAKE_BINARIES; do
  if [ -x "$USR/bin/$binary" ] && [ ! -L "$USR/bin/$binary" ]; then
    ok "bin/$binary is a copy, as in the flake"
  else
    fail "bin/$binary is a copy, as in the flake" \
      "missing or a symlink; \`current_exe\` would not find libexec beside it"
  fi
done
expect "bin holds only what the flake installs" "$FLAKE_BINARIES" \
  "$(ls "$USR/bin" | sort)"
[ -x "$LIBEXEC/engine/chrome" ] && [ -f "$LIBEXEC/engine/locales/en-US.pak" ] &&
  ok "the engine is libexec/domicile/engine, as unpacked" ||
  fail "the engine is libexec/domicile/engine, as unpacked" \
    "$(ls -R "$LIBEXEC/engine" 2>&1)"
for shell in manganese simple splash; do
  [ -f "$LIBEXEC/shells/$shell/shell.js" ] &&
    ok "the $shell shell is prebuilt" ||
    fail "the $shell shell is prebuilt" "no $LIBEXEC/shells/$shell/shell.js"
done
for app in history settings; do
  [ -f "$LIBEXEC/apps/$app/manifest.json" ] &&
    ok "the $app app is installed" ||
    fail "the $app app is installed" "no $LIBEXEC/apps/$app/manifest.json"
done

echo "the builder runs the bundled bun against the bundled workspace"
expect "the builder's command line" \
  "$LIBEXEC/workspace/packages/domicile-builder/src/main.ts --domicile $LIBEXEC/workspace --entry desk.tsx" \
  "$("$LIBEXEC/builder" --entry desk.tsx 2>&1)"
[ -f "$LIBEXEC/workspace/node_modules/vite/index.js" ] &&
  [ -f "$LIBEXEC/workspace/package.json" ] &&
  ok "the workspace has its modules" ||
  fail "the workspace has its modules" "$(ls -a "$LIBEXEC/workspace" 2>&1)"
[ ! -e "$LIBEXEC/workspace/node_modules/.cache" ] &&
  ok "without the module cache" ||
  fail "without the module cache" "node_modules/.cache was copied"
[ ! -e "$LIBEXEC/workspace/packages/domicile-launch" ] &&
  ok "and without the crates" ||
  fail "and without the crates" "packages/domicile-launch was copied"

echo "the session and what it starts"
SESSION="$USR/share/wayland-sessions/domicile.desktop"
holds_line "the session runs domicile" "$SESSION" "Exec=/usr/bin/domicile"
holds_line "the session names the desktop" "$SESSION" "DesktopNames=domicile"
for unit in domicile-session.target domicile-session-shutdown.target; do
  cmp -s "$ROOT/nix/$unit" "$USR/lib/systemd/user/$unit" &&
    ok "$unit is the flake's" ||
    fail "$unit is the flake's" "missing or different"
done
cmp -s "$ROOT/nix/domicile.portal" "$USR/share/xdg-desktop-portal/portals/domicile.portal" &&
  ok "domicile.portal is the flake's" ||
  fail "domicile.portal is the flake's" "missing or different"
cmp -s "$ROOT/nix/domicile-portals.conf" "$USR/share/xdg-desktop-portal/domicile-portals.conf" &&
  ok "domicile-portals.conf is the flake's" ||
  fail "domicile-portals.conf is the flake's" "missing or different"
holds_line "the domicile group is declared" "$USR/lib/sysusers.d/domicile.conf" \
  "g domicile -"

echo "links open on the desktop"
holds_line "the link handler runs domicile-open-url" \
  "$USR/share/applications/domicile-open-url.desktop" "Exec=/usr/bin/domicile-open-url %u"
holds_line "and is the default for https" \
  "$USR/share/applications/domicile-mimeapps.list" \
  "x-scheme-handler/https=domicile-open-url.desktop"

echo "the launcher's entries"
for entry in history settings screenshot; do
  file="$USR/share/applications/domicile-$entry.desktop"
  icon="$(sed -n 's/^Icon=//p' "$file" 2>/dev/null)"
  preview="$(sed -n 's/^X-Domicile-Preview=//p' "$file" 2>/dev/null)"
  if [ -n "$icon" ] && [ -f "$STAGE$icon" ] && [ -n "$preview" ] && [ -f "$STAGE$preview" ]; then
    ok "domicile-$entry.desktop names icons the package holds"
  else
    fail "domicile-$entry.desktop names icons the package holds" \
      "Icon=$icon X-Domicile-Preview=$preview"
  fi
done
holds_line "Screenshot runs domicile screenshot" \
  "$USR/share/applications/domicile-screenshot.desktop" "Exec=/usr/bin/domicile screenshot"

left="$(grep -rlE '@[a-z]+@' "$USR/share" 2>/dev/null)"
expect "no placeholder is left unfilled" "" "$left"

# ---- incomplete inputs -----------------------------------------------------

echo "incomplete inputs are refused"
refused() { # what, needle, stage.sh arguments...
  local what="$1" needle="$2" out; shift 2
  rm -rf "$WORK/refused"
  if out="$("$STAGE_SH" "$@" "$WORK/refused" 2>&1)"; then
    fail "$what" "stage.sh succeeded"
  else
    case "$out" in
      (*"$needle"*) ok "$what" ;;
      (*) fail "$what" "the refusal does not name $needle: $out" ;;
    esac
  fi
}

mv "$BINARIES/domicile-settings-host" "$WORK/held"
refused "a missing binary is named" domicile-settings-host \
  "$BINARIES" "$ENGINE" "$BUN" "$WORKSPACE"
mv "$WORK/held" "$BINARIES/domicile-settings-host"

rm "$ENGINE/libdomicile_engine.so"
refused "an engine without its library is named" libdomicile_engine.so \
  "$BINARIES" "$ENGINE" "$BUN" "$WORKSPACE"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
