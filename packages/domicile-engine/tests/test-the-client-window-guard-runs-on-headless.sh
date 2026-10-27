#!/usr/bin/env bash
# Tests how `guard-client-window.sh` starts its engine and compositor.
#
# `HEADLESS=1` runs the shared-memory path with no host compositor: the engine
# on ozone headless, on the CPU, and the compositor sending windows in memory.
# That is a headless desktop's only path (docs/architecture/A-HEADLESS-DESKTOP.md),
# so a regression there would blank every window. Without it, the engine stays
# on Wayland, where a dmabuf import works.
#
# The guard runs for real against a stand-in engine, which records its
# switches and opens the broker socket, and a stand-in compositor, which
# records its switches and exits. The guard then fails, which is not under
# test.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"

FAILED=0
expect() { # what, wanted (a word), switches
  if printf '%s\n' "$3" | grep -qxF -- "$2"; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$1" "$2" "$(printf '%s' "$3" | tr '\n' ' ')"
    FAILED=$((FAILED + 1))
  fi
}
refuse() { # what, unwanted (a word), switches
  if printf '%s\n' "$3" | grep -qxF -- "$2"; then
    printf '  FAIL  %s\n    did not want: %s\n' "$1" "$2"
    FAILED=$((FAILED + 1))
  else
    printf '  ok    %s\n' "$1"
  fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A checkout with the real guard, so `ROOT` in the guard finds the stand-in
# compositor.
REPO="$WORK/repo"
mkdir -p "$REPO/packages/domicile-engine/scripts" "$REPO/target/debug" \
  "$WORK/chromium/out/Domicile" "$WORK/bin"
cp "$SCRIPTS"/guard-client-window.sh "$SCRIPTS"/lib-*.sh \
  "$REPO/packages/domicile-engine/scripts/"

# The engine: its switches, one per line, then the broker socket the guard
# waits for. It stays up so the guard sees a running engine.
cat >"$WORK/chromium/out/Domicile/chrome" <<'ENGINE'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$SWITCHES/engine"
for switch in "$@"; do
  case "$switch" in
    --domicile-broker-socket=*)
      python3 -c 'import socket, sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])' \
        "${switch#*=}" ;;
  esac
done
exec sleep 60
ENGINE
touch "$WORK/chromium/out/Domicile/libdomicile_engine.so"
cat >"$REPO/target/debug/domicile-compositor" <<'COMPOSITOR'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$SWITCHES/compositor"
COMPOSITOR
# The clients, which never start: the compositor stand-in exits first.
for client in foot kitty; do
  printf '#!/usr/bin/env bash\n' >"$WORK/bin/$client"
done
chmod +x "$WORK/chromium/out/Domicile/chrome" \
  "$REPO/target/debug/domicile-compositor" "$WORK/bin/"*

run_guard() { # environment...
  local switches; switches="$(mktemp -d "$WORK/run.XXXXXX")"
  env "$@" SWITCHES="$switches" PATH="$WORK/bin:$PATH" \
    BROKER="$switches/broker" PROFILE="$switches/profile" \
    LOG_COPY="$switches/comp.log" ENGINE_LOG_COPY="$switches/engine.log" \
    XDG_RUNTIME_DIR="$switches" \
    "$REPO/packages/domicile-engine/scripts/guard-client-window.sh" \
    "$WORK/chromium" >/dev/null 2>&1
  printf '%s\n' "$switches"
}

echo "HEADLESS=1:"
run="$(run_guard SOFTWARE=1 HEADLESS=1)"
engine="$(cat "$run/engine" 2>/dev/null)"
compositor="$(cat "$run/compositor" 2>/dev/null)"
expect "the engine is on ozone headless" --ozone-platform=headless "$engine"
expect "the engine composites on the CPU" --disable-gpu "$engine"
expect "the compositor sends windows in memory" --software-compositing "$compositor"
expect "...set to yes" yes "$compositor"

echo "SOFTWARE=1 alone:"
run="$(run_guard SOFTWARE=1)"
engine="$(cat "$run/engine" 2>/dev/null)"
expect "the engine stays on Wayland" --ozone-platform=wayland "$engine"
expect "the engine composites on the CPU" --disable-gpu "$engine"

echo "neither:"
run="$(run_guard)"
engine="$(cat "$run/engine" 2>/dev/null)"
compositor="$(cat "$run/compositor" 2>/dev/null)"
expect "the engine stays on Wayland" --ozone-platform=wayland "$engine"
refuse "the engine composites on the GPU" --disable-gpu "$engine"
refuse "the compositor sends windows as dmabufs" --software-compositing "$compositor"

[ "$FAILED" -eq 0 ] || { echo "$FAILED failed"; exit 1; }
echo "all passed"
