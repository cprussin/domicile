#!/usr/bin/env bash
# Tests `distro-packages-publish.sh`, which releases the distribution packages
# of a commit stable.yml promoted.
#
# Runs the script in a scratch repository with a `gh` that records its
# arguments and answers `release view` as told.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUBLISH="$ROOT/.github/scripts/distro-packages-publish.sh"
[ -x "$PUBLISH" ] || { echo "no $PUBLISH" >&2; exit 1; }

command -v git >/dev/null 2>&1 || { echo "  SKIP: no git"; exit 77; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}
contains() { # what, needle, hay
  case "$3" in
    (*"$2"*) ok "$1" ;;
    (*) fail "$1" "expected: $2  in: $3" ;;
  esac
}

# A `gh` that logs each call. `release view` succeeds when `$WORK/exists` does.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/gh" <<'GH'
#!/usr/bin/env bash
echo "gh $*" >>"$GH_LOG"
if [ "$1 $2" = "release view" ]; then
  [ -e "$GH_EXISTS" ]
fi
GH
chmod +x "$WORK/bin/gh"

# A repository whose pins are of these two series.
REPO="$WORK/repo"
setup() { # checked series, official series
  rm -rf "$REPO"
  git init -q -b main "$REPO"
  git -C "$REPO" config user.email ci@domicile.invalid
  git -C "$REPO" config user.name "domicile CI"
  mkdir -p "$REPO/.github/scripts" "$REPO/packages/domicile-engine"
  cp "$PUBLISH" "$REPO/.github/scripts/"
  printf '{\n  identity = "%s";\n}\n' "$1" >"$REPO/packages/domicile-engine/engine-release.nix"
  printf '{\n  identity = "%s";\n}\n' "$2" >"$REPO/packages/domicile-engine/engine-official.nix"
  git -C "$REPO" add -A
  git -C "$REPO" commit -qm pins
}

mkdir -p "$WORK/packages"
touch "$WORK/packages/domicile_0.1_amd64.deb" "$WORK/packages/SHA256SUMS"

publish() {
  : >"$WORK/log"
  (cd "$REPO" && PATH="$WORK/bin:$PATH" GH_LOG="$WORK/log" GH_EXISTS="$WORK/exists" \
    GITHUB_REPOSITORY=cprussin/domicile \
    bash .github/scripts/distro-packages-publish.sh "$WORK/packages" 2>&1)
}

echo "a commit with the official engine is released"
setup aaaa aaaa
head="$(git -C "$REPO" rev-parse HEAD)"
rm -f "$WORK/exists"
if out="$(publish)"; then ok "the publish succeeds"; else fail "the publish succeeds" "$out"; fi
log="$(cat "$WORK/log")"
contains "as packages-<commit>, at the commit" \
  "gh release create packages-${head:0:12} --target $head" "$log"
contains "not marked latest" "--latest=false" "$log"
contains "with every package" "$WORK/packages/SHA256SUMS $WORK/packages/domicile_0.1_amd64.deb" "$log"

echo "a release that exists gets its assets again"
touch "$WORK/exists"
if out="$(publish)"; then ok "the publish succeeds"; else fail "the publish succeeds" "$out"; fi
log="$(cat "$WORK/log")"
contains "by an upload" "gh release upload packages-${head:0:12} --clobber" "$log"
case "$log" in
  (*"release create"*) fail "and not a second release" "$log" ;;
  (*) ok "and not a second release" ;;
esac

echo "a commit with the checked engine is not released"
setup bbbb aaaa
rm -f "$WORK/exists"
if out="$(publish)"; then
  fail "the publish is refused" "it succeeded: $out"
else
  contains "the publish is refused, saying why" "checked engine" "$out"
fi
[ ! -s "$WORK/log" ] && ok "and asks GitHub nothing" || fail "and asks GitHub nothing" "$(cat "$WORK/log")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
