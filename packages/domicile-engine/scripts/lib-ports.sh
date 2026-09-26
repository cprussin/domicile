# The ports a guard's own processes took, read back from them.
#
# A guard names no port. `crux` runs two engine jobs at once, each runner with
# a /tmp of its own and one network between them, so a fixed port is one the
# other run may be holding: run 36235045048 lost five guards to `Address
# already in use` that way. Its page server and its engine each bind port 0,
# and the guard asks them which port they got.
#
# Sourced by the guards, and by the fixtures' own tests.
# `scripts/test-the-webview-guards-take-free-ports.sh` is what holds the guards
# to it.

# The port a fixture server took, from the line it prints once bound:
# `serving ... on 127.0.0.1:<port>`. Fails with no such line, or with port 0,
# which is a server repeating what it was asked rather than saying what it got.
served_port() { # $1 the server's log
  local port
  port="$(sed -n 's/^serving .* on 127\.0\.0\.1:\([0-9][0-9]*\).*$/\1/p' "$1" | head -1)"
  case "$port" in
  "" | 0) return 1 ;;
  *) echo "$port" ;;
  esac
}

# The debugging port an engine took for `--remote-debugging-port=0`. Chromium
# writes it, for exactly that case, as the first line of `DevToolsActivePort`
# in the profile -- this engine's own. Waits `$2` quarter-seconds for that line
# to be whole.
devtools_port() { # $1 the engine's --user-data-dir, $2 tries
  local port
  for _ in $(seq 1 "$2"); do
    if [ -f "$1/DevToolsActivePort" ] &&
      IFS= read -r port <"$1/DevToolsActivePort"; then
      case "$port" in
      "" | 0 | *[!0-9]*) ;;
      *) echo "$port"; return 0 ;;
      esac
    fi
    sleep 0.25
  done
  return 1
}
