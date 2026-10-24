#!/usr/bin/env bash
# Tests `distro/version.sh`, the version the distribution packages carry: the
# commit's time, which sorts later for every later commit; for a release, the
# version of `domicile`, the distribution package's manifest; for a prerelease,
# that version marked as coming before it, with the commit's time.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
VERSION_SH="$ROOT/distro/version.sh"
[ -x "$VERSION_SH" ] || { echo "no $VERSION_SH" >&2; exit 1; }

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

mkdir -p "$WORK/packages/domicile"
echo '{"name":"domicile","version":"1.2.3"}' >"$WORK/packages/domicile/package.json"
git -C "$WORK" init -q
git -C "$WORK" add .
GIT_COMMITTER_DATE="2026-10-19T08:09:10+02:00" \
  git -C "$WORK" -c user.name=t -c user.email=t@t commit -q -m one

echo "a snapshot"
expect "is the commit's time, in UTC" 0.20261019.060910 "$("$VERSION_SH" "$WORK" 2>&1)"

echo "a release"
expect "is domicile's version" 1.2.3 "$(DOMICILE_RELEASE=1 "$VERSION_SH" "$WORK" 2>&1)"

echo "a prerelease"
expect "comes before domicile's version, by the commit's time" \
  1.2.3~pre.20261019.060910 "$(DOMICILE_PRERELEASE=1 "$VERSION_SH" "$WORK" 2>&1)"
expect "is a prerelease even in a release" \
  1.2.3~pre.20261019.060910 "$(DOMICILE_RELEASE=1 DOMICILE_PRERELEASE=1 "$VERSION_SH" "$WORK" 2>&1)"

echo "for Arch"
expect "drops the tilde, which pacman sorts after the release" \
  1.2.3pre.20261019.060910 "$(DOMICILE_PRERELEASE=1 "$VERSION_SH" "$WORK" arch 2>&1)"
expect "keeps a release's version" 1.2.3 "$(DOMICILE_RELEASE=1 "$VERSION_SH" "$WORK" arch 2>&1)"
expect "keeps a snapshot's version" 0.20261019.060910 "$("$VERSION_SH" "$WORK" arch 2>&1)"

[ "$FAILED" -eq 0 ]
