#!/usr/bin/env bash
# Install apt packages on a GitHub-hosted runner, with retries.
#
#   .github/scripts/apt-install.sh libxkbcommon-dev libwayland-dev
#
# Retried because `apt-get update` against Azure's mirrors fails and hangs often
# enough to be the most common red run in this repository that says nothing
# about the code. Three attempts with a `timeout` on each, because a hang is the
# failure mode that costs the most: without the timeout a stuck mirror holds the
# job until GitHub kills it twenty minutes later.
#
# A warning rather than an error on an attempt that fails, so a run that
# succeeds on the second try is green with the first one visible. Only the third
# failure is this script's own.
#
# `declare -f` to carry the function into the `timeout` subshell: `timeout` takes
# a command and not a shell function, and `bash -c` gets a fresh shell that has
# never seen it.
set -euo pipefail

[ "$#" -gt 0 ] || {
  echo "usage: apt-install.sh <package>..." >&2
  exit 2
}

install() {
  sudo apt-get update && sudo apt-get install -y "$@"
}

for attempt in 1 2 3; do
  if timeout --kill-after=10 300 \
       bash -c "$(declare -f install); install $*"; then
    exit 0
  fi
  echo "::warning::apt attempt $attempt failed or timed out" >&2
  if [ "$attempt" -lt 3 ]; then
    sleep $((attempt * 5))
  fi
done
echo "::error::apt did not succeed in three attempts" >&2
exit 1
