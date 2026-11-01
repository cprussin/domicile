#!/usr/bin/env bash
# Gives back the old mtime of each file the reset and apply rewrite with the
# same bytes, so ninja rebuilds only what the series changed.
#
#   <paths> | .github/scripts/engine-keep-mtimes.sh save <chromium/src>
#             .github/scripts/engine-keep-mtimes.sh restore <chromium/src>
#             .github/scripts/engine-keep-mtimes.sh drop <chromium/src>
#
# - `save` reads paths relative to the checkout, one per line, and records each
#   file's hash and mtime. `engine-reset.sh` runs it before the reset.
# - `restore` sets the recorded mtime on every file whose bytes match the
#   record, then removes the snapshot. `engine-apply.sh` runs it after the
#   apply.
# - `drop` removes the snapshot. A snapshot is valid only for the reset that
#   wrote it: restoring after a later build could hide that build's changes.
#
# Ninja compares mtimes only, so a file with its old bytes and its old mtime
# reads as never touched. The snapshot lives outside `src/` for the reason
# given in engine-sync.sh.
set -euo pipefail

usage() {
  echo "usage: $(basename "$0") <save|restore|drop> <chromium/src>" >&2
  exit 2
}

action="${1:-}"
CHROMIUM="${2:-}"
[ -n "$action" ] && [ -n "$CHROMIUM" ] || usage

SNAPSHOT="${DOMICILE_KEPT_MTIMES:-$(dirname "$CHROMIUM")/.domicile-kept-mtimes}"

# The hash alone, without a filename. A `sha256sum` failure exits rather than
# reading as "differs".
hash_of() { # file
  local sum
  sum="$(sha256sum <"$1")" || {
    echo "::error::sha256sum failed on $1" >&2
    exit 1
  }
  printf '%s\n' "${sum%% *}"
}

case "$action" in
  save)
    rm -rf "$SNAPSHOT"
    mkdir -p "$SNAPSHOT/refs"
    n=0
    # Each line: index, hash, path. `refs/<index>` is an empty file carrying the
    # mtime, which `touch -r` copies to the nanosecond.
    while IFS= read -r file; do
      case "$file" in
        ("" | /* | ..* | */../* | */..) continue ;;
      esac
      [ -f "$CHROMIUM/$file" ] && [ ! -L "$CHROMIUM/$file" ] || continue
      n=$((n + 1))
      touch -r "$CHROMIUM/$file" "$SNAPSHOT/refs/$n"
      printf '%s\t%s\t%s\n' "$n" "$(hash_of "$CHROMIUM/$file")" "$file"
    done >"$SNAPSHOT/list"
    echo "noted the mtimes of $n files the reset and apply may rewrite"
    ;;

  restore)
    [ -f "$SNAPSHOT/list" ] || {
      echo "no snapshot at $SNAPSHOT, so every rewritten file keeps its new mtime"
      exit 0
    }
    kept=0
    total=0
    while IFS=$'\t' read -r n sum file; do
      total=$((total + 1))
      [ -f "$CHROMIUM/$file" ] && [ ! -L "$CHROMIUM/$file" ] || continue
      [ "$(hash_of "$CHROMIUM/$file")" = "$sum" ] || continue
      touch -r "$SNAPSHOT/refs/$n" "$CHROMIUM/$file"
      kept=$((kept + 1))
    done <"$SNAPSHOT/list"
    rm -rf "$SNAPSHOT"
    echo "gave back the old mtime to $kept of $total files; the other $((total - kept)) changed or are gone, and rebuild"
    ;;

  drop) rm -rf "$SNAPSHOT" ;;

  *) usage ;;
esac
