#!/usr/bin/env bash
# Tests that `release-aur.sh` gives `packages/distro/aur.sh` the repositories' address:
# `DOMICILE_REPO_URL`, else https://packages.domicile-desktop.com.
#
# A stand-in `packages/distro/aur.sh` records its arguments; a local repository stands
# in for the AUR.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RELEASE_AUR="$ROOT/.github/scripts/release-aur.sh"
[ -x "$RELEASE_AUR" ] || { echo "no $RELEASE_AUR" >&2; exit 1; }

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

mkdir -p "$WORK/checkout/.github/scripts" "$WORK/checkout/packages/distro"
cp "$RELEASE_AUR" "$WORK/checkout/.github/scripts/"
cat >"$WORK/checkout/packages/distro/aur.sh" <<'STAND_IN'
#!/usr/bin/env bash
echo "aur.sh $2" >>"$LOG"
STAND_IN
chmod +x "$WORK/checkout/packages/distro/aur.sh"
git init -q --bare "$WORK/aur.git"
touch "$WORK/domicile.pkg.tar.zst"

run() { # environment...
  : >"$WORK/log"
  env -u DOMICILE_REPO_URL -u AUR_SSH_KEY LOG="$WORK/log" \
    DOMICILE_AUR_REMOTE="$WORK/aur.git" "$@" \
    bash "$WORK/checkout/.github/scripts/release-aur.sh" "$WORK/domicile.pkg.tar.zst" 2>&1
}

if out="$(run)"; then
  expect "defaults to Domicile's repositories" \
    "aur.sh https://packages.domicile-desktop.com" "$(cat "$WORK/log")"
else
  printf '  FAIL  the release succeeds\n    %s\n' "$out"
  FAILED=$((FAILED + 1))
fi

if out="$(run DOMICILE_REPO_URL=https://example.test)"; then
  expect "DOMICILE_REPO_URL overrides it" "aur.sh https://example.test" "$(cat "$WORK/log")"
else
  printf '  FAIL  the release succeeds\n    %s\n' "$out"
  FAILED=$((FAILED + 1))
fi

[ "$FAILED" -eq 0 ]
