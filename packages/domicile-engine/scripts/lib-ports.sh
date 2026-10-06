# Reads back the ports a guard's processes bound.
#
# Guards bind port 0 instead of a fixed port: `crux` runs two engine jobs on
# one network, so a fixed port can collide (`Address already in use`).
#
# Sourced by the guards and the fixtures' tests.
# `scripts/test-the-webview-guards-take-free-ports.sh` enforces this.

# The port a fixture server bound, from its `serving ... on 127.0.0.1:<port>`
# line. Fails on no line or on port 0 (the requested port, not the bound one).
served_port() { # $1 the server's log
  local port
  port="$(sed -n 's/^serving .* on 127\.0\.0\.1:\([0-9][0-9]*\).*$/\1/p' "$1" | head -1)"
  case "$port" in
  "" | 0) return 1 ;;
  *) echo "$port" ;;
  esac
}

# The port an engine bound for `--remote-debugging-port=0`, from the first
# line of `DevToolsActivePort` in its profile. Waits up to `$2` quarter-seconds
# for a complete line.
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
