#!/usr/bin/env bash
# Lays out the workspace the shell builder runs from: the builder and
# manganese, the workspace packages they link, and their production modules.
# `distro/stage.sh` and `shellWorkspace` in `flake.nix` both run it.
#
#   distro/shell-workspace.sh modules <bun> <workspace> <out>
#   distro/shell-workspace.sh files <bun> <workspace> <out>
#
# - `modules`: installs the production modules into <out> from <workspace>'s
#   manifests and `bun.lock`. Reads no source, so the flake runs it in a
#   fixed-output derivation.
# - `files`: copies each shipped package's published files from <workspace>,
#   built, into <out> after `modules`.
set -euo pipefail

[ "$#" -eq 4 ] || {
  echo "usage: shell-workspace.sh modules|files <bun> <workspace> <out>" >&2
  exit 2
}
STEP="$1"
BUN="$2"
WORKSPACE="$3"
OUT="$4"

ROOTS=(domicile-builder shell-manganese)

# Every manifest is copied because the frozen install checks the lockfile
# against all of them.
modules() {
  mkdir -p "$OUT/packages"
  cp "$WORKSPACE/package.json" "$WORKSPACE/bun.lock" "$WORKSPACE/bunfig.toml" "$OUT/"
  for manifest in "$WORKSPACE"/packages/*/package.json; do
    package="$(basename "$(dirname "$manifest")")"
    mkdir -p "$OUT/packages/$package"
    cp "$manifest" "$OUT/packages/$package/"
  done
  (cd "$OUT" && "$BUN" install --production --frozen-lockfile --ignore-scripts \
    --no-progress "${ROOTS[@]/#/--filter=./packages/}")
  find "$OUT/node_modules" -type f \( -name '*.map' -o -iname 'README*' \) -delete
  # bun installs native modules for both C libraries; the packages need glibc.
  rm -rf "$OUT"/node_modules/.bun/*-musl@*
}

# Each package's published files: what `bun pm pack` would pack. Then drops
# the links left dangling by `modules`.
files() {
  for package in "${ROOTS[@]}" $(linked); do
    (cd "$WORKSPACE/packages/$package" && "$BUN" pm pack --dry-run --ignore-scripts) |
      sed -n 's/^packed [^ ]* //p' |
      while IFS= read -r file; do
        install -D -m 644 "$WORKSPACE/packages/$package/$file" "$OUT/packages/$package/$file"
      done
  done
  find "$OUT" -xtype l -delete
}

# The workspace packages the install linked, by directory name.
linked() {
  local packages target
  packages="$(cd "$OUT/packages" && pwd -P)"
  find "$OUT"/packages/*/node_modules -type l -print0 |
    while IFS= read -r -d '' link; do
      target="$(readlink -f "$link")"
      [ "$(dirname "$target")" != "$packages" ] || basename "$target"
    done | sort -u
}

case "$STEP" in
  modules) modules ;;
  files) files ;;
  *)
    echo "shell-workspace.sh: no step $STEP" >&2
    exit 2
    ;;
esac
