#!/usr/bin/env bash
# Tests `packages/distro/version-file.sh`, which writes what
# `domicile --version` prints first.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
VERSION_FILE="$ROOT/packages/distro/version-file.sh"
[ -x "$VERSION_FILE" ] || { echo "no $VERSION_FILE" >&2; exit 1; }

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

REV=0123456789abcdef0123456789abcdef01234567
ENGINE="$WORK/packages/domicile-engine"
mkdir -p "$ENGINE" "$WORK/packages/domicile"
printf '{"name":"domicile","private":true,"version":"1.2.3"}\n' >"$WORK/packages/domicile/package.json"
pin() { # file, identity
  printf '{\n  identity = "%s";\n  commit = "abc";\n}\n' "$2" >"$ENGINE/$1"
}

echo "a release"
pin engine-release.nix aaaa
expect "names domicile's version" "$(printf 'domicile 1.2.3\ncommit   %s' "$REV")" \
  "$(DOMICILE_RELEASE=1 "$VERSION_FILE" "$WORK" "$REV" 2>&1)"

echo "a commit that runs the checked engine"
expect "is main, with no official pin" "$(printf 'domicile main 0123456789ab\ncommit   %s' "$REV")" \
  "$("$VERSION_FILE" "$WORK" "$REV" 2>&1)"
pin engine-official.nix bbbb
expect "is main, with an official pin of another series" \
  "$(printf 'domicile main 0123456789ab\ncommit   %s' "$REV")" \
  "$("$VERSION_FILE" "$WORK" "$REV" 2>&1)"

echo "a commit that runs the official engine"
pin engine-official.nix aaaa
expect "is stable" "$(printf 'domicile stable 0123456789ab\ncommit   %s' "$REV")" \
  "$("$VERSION_FILE" "$WORK" "$REV" 2>&1)"

echo "a dirty checkout"
expect "says so" "$(printf 'domicile stable 0123456789ab-dirty\ncommit   %s-dirty' "$REV")" \
  "$("$VERSION_FILE" "$WORK" "$REV-dirty" 2>&1)"

echo "a workspace without a checked pin"
rm "$ENGINE/engine-release.nix"
"$VERSION_FILE" "$WORK" "$REV" >/dev/null 2>&1 &&
  fail "fails" "succeeded" || ok "fails"

[ "$FAILED" -eq 0 ]
