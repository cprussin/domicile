#!/usr/bin/env bash
# Install apt packages on a GitHub-hosted runner, with retries.
#
#   .github/scripts/apt-install.sh libxkbcommon-dev libwayland-dev
#
# - Retries: `apt-get update` against Azure's mirrors often fails or hangs.
# - A `timeout` on each attempt: a stuck mirror otherwise holds the job until
#   GitHub kills it.
# - Failed attempts before the last are warnings, so a run that succeeds on a
#   retry stays green.
# - `--no-install-recommends`: recommends pull in large packages (weston's pull
#   in ffmpeg) that slow mirrors time out on.
# - `declare -f` carries the function into `bash -c`, because `timeout` cannot
#   run a shell function.
set -euo pipefail

[ "$#" -gt 0 ] || {
  echo "usage: apt-install.sh <package>..." >&2
  exit 2
}

install() {
  sudo apt-get update && sudo apt-get install -y --no-install-recommends "$@"
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
