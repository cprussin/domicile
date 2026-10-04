#!/usr/bin/env bash
# Asserts where `engine-release-repin.sh` commits the regenerated
# `engine-release.nix`.
#
# `engine.yml` publishes a release from the branch head and pushes the
# regenerated file back onto the branch. A `pull_request` run is checked out at
# `refs/pull/N/merge`, which includes main. Pushing that commit would merge main
# into the author's branch without showing in the diff, so the script must
# commit on the fetched branch tip.
#
# The generator is faked and pushes go to a local bare remote; the commit's
# placement is under test.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPIN="$ROOT/.github/scripts/engine-release-repin.sh"
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

# A repository like this one, with a remote and a branch that main has moved
# past. With an argument, main also repins, so `engine-release.nix` differs
# between the merge ref and the branch tip.
setup() {
  local main_repins="${1:-}"
  rm -rf "$WORK/remote" "$WORK/repo"
  git init -q --bare "$WORK/remote"

  git init -q -b main "$WORK/repo"
  git -C "$WORK/repo" config user.email ci@domicile.invalid
  git -C "$WORK/repo" config user.name "domicile CI"
  # Some git versions print `fatal: expected 'acknowledgments'` against a local
  # bare remote and push anyway. Disable negotiation so the test output stays
  # clean.
  git -C "$WORK/repo" config push.negotiate false
  mkdir -p "$WORK/repo/.github/scripts" "$WORK/repo/scripts" \
           "$WORK/repo/packages/domicile-engine"
  cp "$REPIN" "$WORK/repo/.github/scripts/"
  echo "pinned = 0" >"$WORK/repo/packages/domicile-engine/engine-release.nix"
  echo "main" >"$WORK/repo/marker"
  git -C "$WORK/repo" add -A
  git -C "$WORK/repo" commit -qm "main"
  git -C "$WORK/repo" remote add origin "$WORK/remote"
  git -C "$WORK/repo" push -q origin main

  # A branch commit main does not have. The push must land on top of it.
  git -C "$WORK/repo" checkout -qb feature
  echo "the branch's own work" >"$WORK/repo/branch-only"
  git -C "$WORK/repo" add -A
  git -C "$WORK/repo" commit -qm "branch work"
  git -C "$WORK/repo" push -q origin feature
  BRANCH_TIP="$(git -C "$WORK/repo" rev-parse feature)"

  # The merge ref the job runs on, detached as `actions/checkout` leaves it.
  git -C "$WORK/repo" checkout -q main
  echo "main moved" >"$WORK/repo/marker"
  [ -z "$main_repins" ] ||
    echo "pinned = 2" >"$WORK/repo/packages/domicile-engine/engine-release.nix"
  git -C "$WORK/repo" commit -qam "main moved"
  git -C "$WORK/repo" push -q origin main
  git -C "$WORK/repo" checkout -q --detach
  git -C "$WORK/repo" merge -q --no-edit feature
  MERGE_REF="$(git -C "$WORK/repo" rev-parse HEAD)"

  # Fake generator: the real one downloads and hashes a tarball.
  mkdir -p "$WORK/repo/scripts"
  cat > "$WORK/repo/scripts/update-engine-release.sh" <<'GEN'
#!/usr/bin/env bash
set -eu
[ -z "${GENERATOR_FAILS:-}" ] || { echo "no such release" >&2; exit 1; }
printf 'pinned = 1 # %s\n' "${DOMICILE_ENGINE_TAG:-none}" \
  > packages/domicile-engine/engine-release.nix
GEN
  chmod +x "$WORK/repo/scripts/update-engine-release.sh"
}

repin() { # extra env assignments
  local out
  if out="$(cd "$WORK/repo" && env DOMICILE_ENGINE_TAG=engine-sabc123456789 \
              "$@" bash .github/scripts/engine-release-repin.sh feature 2>&1)"; then
    printf 'ok\n%s\n' "$out"
  else
    printf 'refused\n%s\n' "$out"
  fi
}
status() { printf '%s\n' "$1" | head -1; }
pushed() { git -C "$WORK/remote" rev-parse "$1" 2>/dev/null || echo missing; }

echo "== the commit lands on the branch tip, not on the merge ref =="

setup
out="$(repin)"
expect "the repin succeeds" ok "$(status "$out")"

# The remote branch must be one commit past its old tip: not the merge, and
# without main's later work.
tip="$(pushed feature)"
expect "the branch moved by exactly one commit" "$BRANCH_TIP" \
  "$(git -C "$WORK/repo" rev-parse "$tip^" 2>/dev/null || echo "not a child of the tip")"
expect "and it is not the merge ref" ok \
  "$([ "$tip" != "$MERGE_REF" ] && echo ok || echo "it pushed the merge")"
expect "so main's later work did not arrive on the branch" ok \
  "$(git -C "$WORK/repo" show "$tip:marker" 2>/dev/null | grep -qx main && echo ok || echo "main moved into the branch")"

# The commit changes only the generated file.
expect "the commit touches one file" \
  "packages/domicile-engine/engine-release.nix" \
  "$(git -C "$WORK/repo" diff --name-only "$tip^" "$tip")"

contains "the message says what it is" "engine-sabc123456789" \
  "$(git -C "$WORK/repo" log -1 --format=%B "$tip")"

echo
echo "== a repin main got to first does not block the checkout =="

# The generator runs at the merge ref and the commit goes on the tip. If
# `engine-release.nix` differs between them, a plain checkout refuses to
# overwrite the modified file. This runs after the build and publish, so a
# failure here wastes an hour of work.
setup main-repins-too
out="$(repin)"
expect "the repin succeeds" ok "$(status "$out")"
expect "and the branch holds what the generator wrote" \
  "pinned = 1 # engine-sabc123456789" \
  "$(git -C "$WORK/repo" show \
       "$(pushed feature):packages/domicile-engine/engine-release.nix" 2>/dev/null)"

echo
echo "== it does nothing when there is nothing to do =="

# A re-run, or a generator that writes the existing file, must not push an
# empty commit: it would re-trigger every check on the pull request.
setup
repin >/dev/null
first="$(pushed feature)"
out="$(repin)"
expect "a second run succeeds" ok "$(status "$out")"
expect "and pushes nothing" "$first" "$(pushed feature)"
contains "and says why" "already" "$out"

echo
echo "== what it refuses to do =="

# A generator that cannot find the release must fail the job and push nothing,
# since the release and the pin would disagree.
setup
out="$(repin GENERATOR_FAILS=1)"
expect "a generator that fails fails the step" refused "$(status "$out")"
expect "and nothing is pushed" "$BRANCH_TIP" "$(pushed feature)"

echo
echo "== the push that makes CI run =="

# A push with the workflow's own token starts runs that need approval. With
# DOMICILE_WRITEBACK_TOKEN set, the push uses that token. A `git` wrapper on
# PATH records the push arguments.
REAL_GIT="$(command -v git)"
mkdir -p "$WORK/bin"
cat >"$WORK/bin/git" <<WRAP
#!/bin/sh
case " \$* " in (*" push "*) printf '%s\n' "\$*" >>"$WORK/push-args" ;; esac
exec "$REAL_GIT" "\$@"
WRAP
chmod +x "$WORK/bin/git"

setup
rm -f "$WORK/push-args"
out="$(repin PATH="$WORK/bin:$PATH" DOMICILE_WRITEBACK_TOKEN=s3cret)"
expect "a repin with a token succeeds" ok "$(status "$out")"
contains "and the push carries the token" \
  "AUTHORIZATION: basic $(printf 'x-access-token:s3cret' | base64 | tr -d '\n')" \
  "$(cat "$WORK/push-args" 2>/dev/null)"

setup
rm -f "$WORK/push-args"
out="$(repin PATH="$WORK/bin:$PATH")"
expect "without one, the push carries no header" no \
  "$(grep -q extraheader "$WORK/push-args" 2>/dev/null && echo yes || echo no)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "engine-release-repin: all cases passed"
else
  echo "engine-release-repin: $FAILED case(s) failed"
fi
exit "$FAILED"
