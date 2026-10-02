#!/usr/bin/env bash
# `stable` is the newest main that runs the official engine.
#
# Main takes a merge as soon as its checks pass, but the official engine (PGO,
# ThinLTO, no DCHECKs) is built nightly, so after a merge that moves the fork
# main runs the CHECKED engine until the night's build is pinned. Somebody
# running `nix run github:cprussin/domicile/stable` should never get that one.
# So stable.yml moves `stable` to each main commit whose official pin is of the
# checked pin's series -- the commit engine-pin.nix picks the official engine
# for -- and leaves it where it is otherwise.
#
# `git` is real against a local remote.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROMOTE="$ROOT/.github/scripts/promote-stable.sh"
[ -x "$PROMOTE" ] || { echo "no $PROMOTE" >&2; exit 1; }

command -v git >/dev/null 2>&1 || { echo "  SKIP: no git"; exit 77; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}
contains() {
  local what="$1" needle="$2" hay="$3"
  case "$hay" in
    (*"$needle"*) printf '  ok    %s\n' "$what" ;;
    (*) printf '  FAIL  %s\n    expected to mention: %s\n    said: %s\n' \
          "$what" "$needle" "$hay"; FAILED=$((FAILED + 1)) ;;
  esac
}

CHECKED=packages/domicile-engine/engine-release.nix
OFFICIAL=packages/domicile-engine/engine-official.nix

# A repository with a bare remote and nothing on main yet.
setup() {
  rm -rf "$WORK/remote" "$WORK/repo"
  git init -q --bare "$WORK/remote"
  git init -q -b main "$WORK/repo"
  git -C "$WORK/repo" config user.email ci@domicile.invalid
  git -C "$WORK/repo" config user.name "domicile CI"
  git -C "$WORK/repo" config push.negotiate false
  git -C "$WORK/repo" remote add origin "$WORK/remote"
  mkdir -p "$WORK/repo/.github/scripts" "$WORK/repo/packages/domicile-engine"
  cp "$PROMOTE" "$WORK/repo/.github/scripts/"
}

# A commit on main pinning these two series, pushed, and the checkout left on
# it detached, as `actions/checkout` leaves it.
merge() { # checked series, official series
  git -C "$WORK/repo" checkout -q main 2>/dev/null || true
  printf '{\n  identity = "%s";\n}\n' "$1" >"$WORK/repo/$CHECKED"
  printf '{\n  identity = "%s";\n}\n' "$2" >"$WORK/repo/$OFFICIAL"
  git -C "$WORK/repo" add -A
  git -C "$WORK/repo" commit -qm "checked $1, official $2" --allow-empty
  git -C "$WORK/repo" push -q origin main
  git -C "$WORK/repo" checkout -q --detach
  git -C "$WORK/repo" rev-parse HEAD
}

promote() {
  local out
  if out="$(cd "$WORK/repo" && bash .github/scripts/promote-stable.sh 2>&1)"; then
    printf 'ok\n%s\n' "$out"
  else
    printf 'refused\n%s\n' "$out"
  fi
}
status() { printf '%s\n' "$1" | head -1; }
stable() { git -C "$WORK/remote" rev-parse -q --verify refs/heads/stable 2>/dev/null || echo missing; }

echo "== a main that runs the official engine is stable =="

setup
tip="$(merge aaaa aaaa)"
out="$(promote)"
expect "the promotion succeeds" ok "$(status "$out")"
expect "and stable is made, at main" "$tip" "$(stable)"

tip="$(merge aaaa aaaa)"
out="$(promote)"
expect "a later main of the same series succeeds" ok "$(status "$out")"
expect "and moves stable forward to it" "$tip" "$(stable)"

echo "== a main still running the checked engine is not =="

before="$(stable)"
merge bbbb aaaa >/dev/null
out="$(promote)"
expect "the promotion succeeds" ok "$(status "$out")"
contains "and says why it did nothing" "series bbbb" "$out"
expect "and leaves stable where it was" "$before" "$(stable)"

echo "== the night's pin brings stable up to main =="

tip="$(merge bbbb bbbb)"
out="$(promote)"
expect "the promotion succeeds" ok "$(status "$out")"
expect "and stable is main again" "$tip" "$(stable)"

echo "== a run behind a newer one leaves stable alone =="

newer="$(merge bbbb bbbb)"
promote >/dev/null
git -C "$WORK/repo" checkout -q --detach "$tip"
out="$(promote)"
expect "the promotion succeeds" ok "$(status "$out")"
expect "and does not take stable back" "$newer" "$(stable)"

echo "== a stable that is not main's is refused, not overwritten =="

setup
merge aaaa aaaa >/dev/null
git -C "$WORK/repo" checkout -q --orphan elsewhere
git -C "$WORK/repo" commit -qm elsewhere --allow-empty
git -C "$WORK/repo" push -q origin elsewhere:stable
foreign="$(stable)"
git -C "$WORK/repo" checkout -q --detach main
out="$(promote)"
expect "the promotion is refused" refused "$(status "$out")"
contains "saying why" "not overwriting it" "$out"
expect "and stable is untouched" "$foreign" "$(stable)"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
