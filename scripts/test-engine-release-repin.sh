#!/usr/bin/env bash
# The commit that replaces the second pull request, and where it lands.
#
# An engine change used to be two pull requests: one that moved the fork, and
# one that moved `engine-release.nix` onto the tarball a manually dispatched
# release produced. The second is the one that got skipped, so changes needing
# a release shipped without one. The merge queue's engine build publishes the
# release now, and `engine-repin.yml` pushes the regenerated file onto main
# after the merge, so merging the first pull request is sufficient.
#
# WHAT THIS IS ABOUT IS WHICH COMMIT THAT PUSH IS BUILT ON. The run is checked
# out at the commit whose push started it, and main can have moved since --
# the queue merges the next change while this one is still hashing a tarball.
# A commit built on the checkout would then be a push that either fails or,
# forced, throws away somebody's merge. So main's tip is fetched and the
# generated file put on it, alone.
#
# `git` and the generator are both faked. What is under test is the decision
# about where the commit goes and whether one is made at all — not `nix store
# prefetch-file`, and not GitHub.
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

# A repository shaped like this one, with a remote to push to and a main that
# has moved on since the commit the run checked out.
setup() {
  rm -rf "$WORK/remote" "$WORK/repo"
  git init -q --bare "$WORK/remote"

  git init -q -b main "$WORK/repo"
  git -C "$WORK/repo" config user.email ci@domicile.invalid
  git -C "$WORK/repo" config user.name "domicile CI"
  # Off, because it is not off by default everywhere and against a local bare
  # repository some git versions print `fatal: expected 'acknowledgments'` and
  # then push anyway. AGENTS.md is explicit that a noisy line reads as a
  # failure; a warning this test produces about its own fixture is worse than
  # one about the thing under test.
  git -C "$WORK/repo" config push.negotiate false
  mkdir -p "$WORK/repo/.github/scripts" "$WORK/repo/scripts" \
           "$WORK/repo/packages/domicile-engine"
  cp "$REPIN" "$WORK/repo/.github/scripts/"
  echo "pinned = 0" >"$WORK/repo/packages/domicile-engine/engine-release.nix"
  echo "the merge that moved the fork" >"$WORK/repo/marker"
  git -C "$WORK/repo" add -A
  git -C "$WORK/repo" commit -qm "the merge that moved the fork"
  git -C "$WORK/repo" remote add origin "$WORK/remote"
  git -C "$WORK/repo" push -q origin main
  PUSHED="$(git -C "$WORK/repo" rev-parse main)"

  # The queue's next merge, landed while this run was working. This is what
  # the push must land on top of.
  echo "the next merge" >"$WORK/repo/marker"
  git -C "$WORK/repo" commit -qam "the next merge"
  git -C "$WORK/repo" push -q origin main
  MAIN_TIP="$(git -C "$WORK/repo" rev-parse main)"

  # And the checkout the job is actually standing on: the commit whose push
  # started it, as `actions/checkout` leaves it.
  git -C "$WORK/repo" reset -q --hard "$PUSHED"

  # The generator, faked: the real one downloads a tarball and hashes it, and
  # what this file is about is what happens to the file afterward.
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
              "$@" bash .github/scripts/engine-release-repin.sh main 2>&1)"; then
    printf 'ok\n%s\n' "$out"
  else
    printf 'refused\n%s\n' "$out"
  fi
}
status() { printf '%s\n' "$1" | head -1; }
pushed() { git -C "$WORK/remote" rev-parse "$1" 2>/dev/null || echo missing; }

echo "== the commit lands on main's tip, not on the checkout =="

setup
out="$(repin)"
expect "the repin succeeds" ok "$(status "$out")"

# THE ASSERTION THIS FILE EXISTS FOR. `main` on the remote must be one commit
# on top of where it is now -- not on the checkout, and not without the merge
# that landed after it.
tip="$(pushed main)"
expect "main moved by exactly one commit" "$MAIN_TIP" \
  "$(git -C "$WORK/repo" rev-parse "$tip^" 2>/dev/null || echo "not a child of main's tip")"
expect "so the next merge is still on main" ok \
  "$(git -C "$WORK/repo" show "$tip:marker" 2>/dev/null | grep -qx "the next merge" && echo ok || echo "the next merge was lost")"

# And it carries only the generated file, because anything else in that commit
# is CI editing main.
expect "the commit touches one file" \
  "packages/domicile-engine/engine-release.nix" \
  "$(git -C "$WORK/repo" diff --name-only "$tip^" "$tip")"

contains "the message says what it is" "engine-sabc123456789" \
  "$(git -C "$WORK/repo" log -1 --format=%B "$tip")"
contains "and what wrote it" "engine-repin.yml" \
  "$(git -C "$WORK/repo" log -1 --format=%B "$tip")"

echo
echo "== it does nothing when there is nothing to do =="

# THE IDEMPOTENT CASE, AND IT IS NOT RARE. A re-run of a green job, or a job
# whose generator produces the file that is already there. An empty commit
# pushed to main on every re-run would be noise at best, and at worst it
# re-triggers every check on main for no change.
setup
repin >/dev/null
first="$(pushed main)"
out="$(repin)"
expect "a second run succeeds" ok "$(status "$out")"
expect "and pushes nothing" "$first" "$(pushed main)"
contains "and says why" "already" "$out"

echo
echo "== what it refuses to do =="

# A generator that cannot find the release must not produce an empty commit or
# a half-written file. This runs after the publish step, so a failure here
# means the release and the repin disagree — which is worth the job going red
# rather than a main that looks repinned and is not.
setup
out="$(repin GENERATOR_FAILS=1)"
expect "a generator that fails fails the step" refused "$(status "$out")"
expect "and nothing is pushed" "$MAIN_TIP" "$(pushed main)"

echo
echo "== the push that makes CI run =="

# A push with the workflow's own token starts runs that wait for a person. Given
# DOMICILE_WRITEBACK_TOKEN, the push authenticates with it instead, and only the
# push: a git on PATH records what the push was given.
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
