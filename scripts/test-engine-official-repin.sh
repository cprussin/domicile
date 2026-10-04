#!/usr/bin/env bash
# Tests `engine-official-repin.sh`, which lands the official engine's pin on
# main.
#
# `engine-release.yml` builds the official engine (PGO, ThinLTO, no DCHECKs)
# after a merge. `engine-official.nix` holds the tarball's hash, so it can only
# be written after the build. Main accepts changes only through pull requests,
# so the job pushes a branch, opens a pull request with the repository's token
# and enables auto-merge, reusing one a previous run left open. GitHub's
# refusals are printed.
#
# If main's series changed during the build, nothing lands: engine-pin.nix
# uses the official pin only when its identity matches the checked pin.
#
# `curl` and the generator are stubbed; `git` runs against a local remote.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPIN="$ROOT/.github/scripts/engine-official-repin.sh"
[ -x "$REPIN" ] || { echo "no $REPIN" >&2; exit 1; }

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

# A repository whose main pins the checked engine of the given series, pushed
# to a bare remote, with a detached checkout as `actions/checkout` leaves it.
setup() { # main's series
  rm -rf "$WORK/remote" "$WORK/repo" "$WORK/bin"
  git init -q --bare "$WORK/remote"
  git init -q -b main "$WORK/repo"
  git -C "$WORK/repo" config user.email ci@domicile.invalid
  git -C "$WORK/repo" config user.name "domicile CI"
  git -C "$WORK/repo" config push.negotiate false
  mkdir -p "$WORK/repo/.github/scripts" "$WORK/repo/scripts" \
           "$WORK/repo/packages/domicile-engine"
  cp "$REPIN" "$WORK/repo/.github/scripts/"
  printf '{\n  identity = "%s";\n}\n' "$1" >"$WORK/repo/$CHECKED"
  echo main >"$WORK/repo/marker"

  # A generator stub; the real one downloads and hashes a tarball.
  cat >"$WORK/repo/scripts/update-engine-release.sh" <<'GEN'
#!/usr/bin/env bash
set -eu
[ -z "${GENERATOR_FAILS:-}" ] || { echo "no such release" >&2; exit 1; }
printf '{\n  identity = "%s";\n  url = "%s";\n}\n' \
  "$FAKE_IDENTITY" "$DOMICILE_ENGINE_TAG" >"$DOMICILE_ENGINE_PIN_FILE"
GEN
  chmod +x "$WORK/repo/scripts/update-engine-release.sh"

  git -C "$WORK/repo" add -A
  git -C "$WORK/repo" commit -qm main
  git -C "$WORK/repo" remote add origin "$WORK/remote"
  git -C "$WORK/repo" push -q origin main
  git -C "$WORK/repo" checkout -q --detach
  MAIN_TIP="$(git -C "$WORK/repo" rev-parse HEAD)"

  # A GitHub stub that records each call and its token. Creating a pull
  # request that already exists returns 422.
  mkdir -p "$WORK/bin"
  : >"$WORK/calls"
  : >"$WORK/auth"
  cat >"$WORK/bin/curl" <<'CURL'
#!/usr/bin/env bash
method=GET url="" data="" out=/dev/stdout
while [ $# -gt 0 ]; do
  case "$1" in
    (-X) method="$2"; shift ;;
    (-d|--data) data="$2"; shift ;;
    (-o) out="$2"; shift ;;
    (-H) case "$2" in (Authorization:*) echo "$2" >>"$FAKE_AUTH" ;; esac; shift ;;
    (-w) shift ;;
    (http*) url="$1" ;;
  esac
  shift
done
printf '%s %s %s\n' "$method" "$url" "$data" >>"$FAKE_CALLS"
answer() { printf '%s' "$2" >"$out"; printf '%s' "$1"; }
case "$method $url" in
  ("POST "*/pulls)
    if [ -n "${FAKE_FORBIDDEN:-}" ]; then
      answer 403 '{"message": "Resource not accessible by integration"}'
    elif [ -n "${FAKE_PR_EXISTS:-}" ]; then
      answer 422 '{"message": "A pull request already exists"}'
    else
      answer 201 '{"number": 7, "node_id": "PR_7"}'
    fi ;;
  ("GET "*/pulls\?*) answer 200 '[{"number": 9, "node_id": "PR_9"}]' ;;
  ("POST "*/graphql)
    if [ -n "${FAKE_AUTOMERGE_REFUSED:-}" ]; then
      answer 200 '{"errors": [{"message": "Auto merge is not allowed for this repository"}]}'
    else
      answer 200 '{"data": {"enablePullRequestAutoMerge": {"clientMutationId": null}}}'
    fi ;;
  (*) answer 404 '{"message": "Not Found"}' ;;
esac
CURL
  chmod +x "$WORK/bin/curl"
}

repin() { # extra env assignments
  local out
  if out="$(cd "$WORK/repo" && env PATH="$WORK/bin:$PATH" FAKE_CALLS="$WORK/calls" \
              FAKE_AUTH="$WORK/auth" \
              DOMICILE_ENGINE_TAG=engine-official-sabc123456789 \
              DOMICILE_WRITEBACK_TOKEN=token GITHUB_REPOSITORY=owner/repo \
              "$@" bash .github/scripts/engine-official-repin.sh 2>&1)"; then
    printf 'ok\n%s\n' "$out"
  else
    printf 'refused\n%s\n' "$out"
  fi
}
status() { printf '%s\n' "$1" | head -1; }
pushed() { git -C "$WORK/remote" rev-parse -q --verify "refs/heads/$1" 2>/dev/null || echo missing; }

echo "== a new official engine of main's series lands through a pull request =="

setup aaaa
out="$(repin FAKE_IDENTITY=aaaa)"
expect "the repin succeeds" ok "$(status "$out")"
tip="$(pushed engine-official-pin)"
expect "the branch is one commit on main" "$MAIN_TIP" \
  "$(git -C "$WORK/remote" rev-parse "$tip^" 2>/dev/null || echo "not a child of main")"
expect "and that commit is the official pin alone" "$OFFICIAL" \
  "$(git -C "$WORK/remote" diff --name-only "$tip^" "$tip")"
contains "the pin names the release" engine-official-sabc123456789 \
  "$(git -C "$WORK/remote" show "$tip:$OFFICIAL")"
calls="$(cat "$WORK/calls")"
contains "a pull request is opened from that branch" \
  "POST https://api.github.com/repos/owner/repo/pulls" "$calls"
contains "into main" '"base":"main"' "$calls"
# GITHUB_TOKEN cannot open pull requests here, and ones it opens run no checks.
expect "with the repository's own token, on every call" "Authorization: Bearer token" \
  "$(sort -u "$WORK/auth")"
contains "and set to merge once its checks pass" \
  'POST https://api.github.com/graphql {"query":"mutation($id: ID!) { enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: SQUASH}) { clientMutationId } }","variables":{"id":"PR_7"}}' \
  "$calls"
# An immediate merge would be refused: required checks have not run.
expect "not merged before them" "" "$(grep '/merge' "$WORK/calls")"

echo "== a pull request a previous run left open is the one set to merge =="

setup aaaa
out="$(repin FAKE_IDENTITY=aaaa FAKE_PR_EXISTS=1)"
expect "the repin succeeds" ok "$(status "$out")"
contains "the open one is found by its head" "pulls?head=owner:engine-official-pin" \
  "$(cat "$WORK/calls")"
contains "and set to merge" '"variables":{"id":"PR_9"}' "$(cat "$WORK/calls")"

echo "== GitHub's refusal is printed, not swallowed =="

setup aaaa
out="$(repin FAKE_IDENTITY=aaaa FAKE_FORBIDDEN=1)"
expect "a pull request GitHub will not open is refused" refused "$(status "$out")"
contains "with its status" 403 "$out"
contains "and its reason" "Resource not accessible by integration" "$out"

setup aaaa
out="$(repin FAKE_IDENTITY=aaaa FAKE_AUTOMERGE_REFUSED=1)"
expect "an auto-merge GitHub will not turn on is refused" refused "$(status "$out")"
contains "with its reason" "Auto merge is not allowed for this repository" "$out"

echo "== no token of the repository's own is refused before anything is pushed =="

setup aaaa
out="$(repin FAKE_IDENTITY=aaaa DOMICILE_WRITEBACK_TOKEN=)"
expect "the repin is refused" refused "$(status "$out")"
contains "naming the secret" DOMICILE_WRITEBACK_TOKEN "$out"
expect "and pushes nothing" missing "$(pushed engine-official-pin)"

echo "== nothing to land is not a pull request =="

setup aaaa
# Main already names this engine.
printf '{\n  identity = "%s";\n  url = "%s";\n}\n' aaaa engine-official-sabc123456789 \
  >"$WORK/repo/$OFFICIAL"
git -C "$WORK/repo" checkout -q main
git -C "$WORK/repo" add -A && git -C "$WORK/repo" commit -qm "already pinned"
git -C "$WORK/repo" push -q origin main
git -C "$WORK/repo" checkout -q --detach
out="$(repin FAKE_IDENTITY=aaaa)"
expect "the repin succeeds" ok "$(status "$out")"
expect "and pushes nothing" missing "$(pushed engine-official-pin)"
expect "and asks GitHub for nothing" "" "$(cat "$WORK/calls")"

echo "== an engine of a series main has left is not landed =="

setup bbbb
out="$(repin FAKE_IDENTITY=aaaa)"
expect "the repin succeeds" ok "$(status "$out")"
contains "and says why it did nothing" "main is at series bbbb" "$out"
expect "and pushes nothing" missing "$(pushed engine-official-pin)"
expect "and asks GitHub for nothing" "" "$(cat "$WORK/calls")"

echo "== a generator that fails fails the job =="

setup aaaa
out="$(repin FAKE_IDENTITY=aaaa GENERATOR_FAILS=1)"
expect "the repin is refused" refused "$(status "$out")"
expect "and pushes nothing" missing "$(pushed engine-official-pin)"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
