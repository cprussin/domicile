#!/usr/bin/env bash
# engine-reset.sh leaves a clean tree when the pin turns a dep (a gitlink) into
# files upstream tracks, as Chromium did with third_party/wayland-protocols/kde:
# on the first run from the old pin, and on a rerun whose HEAD is already at
# the new one.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git_() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=main "$@"; }

# The dep at its old revision: a repository of its own with files upstream
# does not keep.
dep="$work/dep"
git_ init -q "$dep"
printf 'old\n' > "$dep/CMakeLists.txt"
printf 'protocol\n' > "$dep/protocol.xml"
git_ -C "$dep" add -A
git_ -C "$dep" commit -qm dep
dep_rev="$(git -C "$dep" rev-parse HEAD)"

# Builds a Chromium checkout in $1 whose old pin names the dep as a gitlink
# and whose new pin tracks one of its files directly, with the dep's old
# checkout in place. Prints the new pin.
make_chromium() {
  local chromium="$1"
  git_ init -q "$chromium"
  printf 'top\n' > "$chromium/README"
  git_ -C "$chromium" add README
  git_ -C "$chromium" update-index --add --cacheinfo "160000,$dep_rev,kde"
  git_ -C "$chromium" commit -qm old
  cp -r "$dep" "$chromium/kde"
  git_ -C "$chromium" rm -q --cached kde
  local blob
  blob="$(git -C "$chromium" hash-object -w "$dep/protocol.xml")"
  git_ -C "$chromium" update-index --add --cacheinfo "100644,$blob,kde/protocol.xml"
  git_ -C "$chromium" commit-tree -p HEAD -m new "$(git -C "$chromium" write-tree)"
  git_ -C "$chromium" reset -q --mixed HEAD
}

# Runs a copy of engine-reset.sh, pinned to $2, on the checkout in $1, and
# checks it leaves the tree clean with the pin's files in kde/.
check_reset() {
  local chromium="$1" pin="$2" root="$work/root-$3"
  mkdir -p "$root/.github/scripts" "$root/packages/domicile-engine/src"
  cp "$REPO/.github/scripts/engine-reset.sh" \
    "$REPO/.github/scripts/engine-keep-mtimes.sh" "$root/.github/scripts/"
  printf '%s\n' "$pin" > "$root/packages/domicile-engine/CHROMIUM_PIN"

  if ! "$root/.github/scripts/engine-reset.sh" "$chromium" > "$work/out" 2>&1; then
    cat "$work/out" >&2
    echo "FAIL ($3): engine-reset.sh refused the tree" >&2
    exit 1
  fi
  local dirty
  dirty="$(git -C "$chromium" status --porcelain --untracked-files=all)"
  [ -z "$dirty" ] || { printf 'FAIL (%s): tree still dirty:\n%s\n' "$3" "$dirty" >&2; exit 1; }
  [ "$(cat "$chromium/kde/protocol.xml")" = protocol ] ||
    { echo "FAIL ($3): kde/protocol.xml is not the pin's" >&2; exit 1; }
}

first="$work/first/src"
mkdir -p "$first"
new="$(make_chromium "$first")"
check_reset "$first" "$new" first-run

rerun="$work/rerun/src"
mkdir -p "$rerun"
new="$(make_chromium "$rerun")"
git -C "$rerun" reset -q --hard "$new" 2>/dev/null
check_reset "$rerun" "$new" rerun

echo "ok: a dep the pin folds into the tree is replaced by the pin's files"
