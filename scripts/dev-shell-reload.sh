#!/usr/bin/env bash
# Reloads the shell in a running desktop each time its bundle is rebuilt.
#
#   ./scripts/dev-shell-reload.sh <domicile> <module> <socket-file> [settle] [burst]
#
# `dev-shell.sh` starts this beside the watcher. It watches one file, waits
# for writes to stop, and runs `domicile load-shell`. See
# docs/architecture/THE-DOMICILE-BINARY.md.
#
# Every input is an argument so `scripts/test-dev-shell.sh` can run it without
# a desktop.
#
# The socket path comes from a file because this script is not a child of the
# supervisor and does not inherit `DOMICILE_SOCK`. `dev-shell.sh` writes the
# file once the desktop reports it is up.
set -u

usage() {
  echo "usage: dev-shell-reload.sh <domicile> <module> <socket-file> [settle] [burst]" >&2
  exit 2
}

DOMICILE="${1:-}"
MODULE="${2:-}"
SOCKET_FILE="${3:-}"
[ -n "$DOMICILE" ] && [ -n "$MODULE" ] && [ -n "$SOCKET_FILE" ] || usage
[ -f "$MODULE" ] || {
  echo "no shell module at $MODULE — nothing would ever be reloaded." >&2
  exit 1
}

# Poll interval in seconds, matching `supervise::ASK_EVERY`.
TICK=0.1
# One build writes the file many times, so reload only once writes stop.
# SETTLE is the quiet ticks that mean the build finished. BURST caps the wait
# for a bundle that never goes quiet. Both match `coalesce.rs`.
SETTLE="${4:-3}"
BURST="${5:-20}"

# Mtime (ns) and size. Hashing megabytes ten times a second is too costly, and
# a rebuild with identical bytes should still reload.
stamp() {
  stat -c '%.Y %s' -- "$MODULE"
}

# Prints the stamp once the file is unchanged for SETTLE ticks or BURST ticks
# have passed.
settled() { # $1 the stamp that opened the burst
  local latest="$1" quiet=0 waited=0 next
  while [ "$quiet" -lt "$SETTLE" ] && [ "$waited" -lt "$BURST" ]; do
    sleep "$TICK"
    waited=$((waited + 1))
    next="$(stamp)"
    if [ "$next" = "$latest" ]; then
      quiet=$((quiet + 1))
    else
      latest="$next"
      quiet=0
    fi
  done
  printf '%s' "$latest"
}

# A refusal is normal: a shell saved mid-edit fails to load. `domicile`
# already prints the engine's reason, and the desktop keeps the previous
# shell, so the loop continues. The same build is not retried.
#
# Stdout only repeats the module path, so it is dropped; stderr is kept.
hand_over() {
  local socket
  read -r socket <"$SOCKET_FILE"
  if DOMICILE_SOCK="$socket" "$DOMICILE" load-shell "$MODULE" >/dev/null; then
    echo "reloaded $MODULE"
  else
    echo "that shell was not taken; the desktop is still serving the one it had." >&2
  fi
}

# Wait for the desktop's socket path.
while [ ! -s "$SOCKET_FILE" ]; do
  sleep "$TICK"
done

# Take the baseline before printing the line, so every build after the line
# triggers a reload.
SERVED="$(stamp)"
echo "reloading $MODULE on every build"
while true; do
  sleep "$TICK"
  LATEST="$(stamp)"
  if [ "$LATEST" != "$SERVED" ]; then
    SERVED="$(settled "$LATEST")"
    hand_over
  fi
done
