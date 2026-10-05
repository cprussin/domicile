#!/usr/bin/env bash
# The engine tells the compositor how big the desktop is and at what density,
# with no help from the page.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-desktop-geometry.sh /build/chromium/src
#
# WHY THIS EXISTS. The shell's window is the desktop, and the compositor never
# sees it: it learns the desktop's size and density only from what the engine
# sends. Every shell used to send both itself (`reportDesktopSize`,
# `reportDevicePixelRatio`), and one that forgot left the compositor laying
# windows out against its startup placeholder with nothing to say so. The
# renderer half of `DomicileHost` sends both now, so the page under test here
# never calls either -- see docs/architecture/WINDOW-DOMICILE.md.
#
# WHAT IT ASSERTS: the stand-in compositor hears `set_desktop_size` with the
# page's own `innerWidth` and `innerHeight`, and `set_device_pixel_ratio` with
# its `devicePixelRatio`, from a page that asked for neither. The density is
# forced to 2 so a report of the default 1 cannot pass by coincidence.
#
# And the page has the whole window: `--no-sandbox` raises Chrome's
# "unsupported command-line flag" infobar, and a shell window that laid it out
# would hand the desktop a page 56px shorter than the window (patch 0091).
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-desktop-geometry: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-desktop-geometry-broker}"
CONTROL="${CONTROL:-/tmp/domicile-desktop-geometry-control}"
PROFILE="${PROFILE:-/tmp/domicile-desktop-geometry-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-desktop-geometry-engine.log}"
SOCKET_LOG="${SOCKET_LOG:-/tmp/domicile-desktop-geometry-socket.log}"
FOR_SECONDS="${FOR_SECONDS:-60}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-desktop-geometry: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-desktop-geometry: no python3, and the compositor's end of the control socket is one"
  exit 77
}

rm -f "$BROKER" "$CONTROL"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

rm -f "$SOCKET_LOG"
python3 "$SCRIPTS/guard-desktop-geometry-compositor.py" --socket "$CONTROL" \
  >"$SOCKET_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "listening on" "$SOCKET_LOG" || {
  annotate_from "guard-desktop-geometry: the compositor stand-in never listened on $CONTROL" "$SOCKET_LOG"
  exit 1
}

rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --window-size=900,700 \
  --force-device-scale-factor=2 \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-desktop-geometry.js" \
  --domicile-control-socket="$CONTROL" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD listening" "$ENGINE_LOG" || {
  annotate_from "guard-desktop-geometry: the shell module never ran" "$ENGINE_LOG"
  tail -40 "$ENGINE_LOG" >&2
  exit 1
}
wait_for_line "$TRIES" "set_device_pixel_ratio" "$SOCKET_LOG"
wait_for_line "$TRIES" "set_desktop_size" "$SOCKET_LOG"
sleep 1

# The page's own numbers, off its console line. The closing quote is Chromium's
# and keeps the match on the message: see guard-control-arrival.sh.
GEOMETRY=$(grep -oE '"GUARD geometry width=[0-9.]+ height=[0-9.]+ ratio=[0-9.]+"' "$ENGINE_LOG" | tail -1)

# The verdict, in Python because the lines are JSON and their numbers may be
# written `900` or `900.0`.
FAILURE=$(GEOMETRY="$GEOMETRY" python3 - "$SOCKET_LOG" <<'PY'
import json, os, re, sys

page = re.search(r"width=([0-9.]+) height=([0-9.]+) ratio=([0-9.]+)", os.environ["GEOMETRY"])
if page is None:
    print("the page never said what it measures, so there is nothing to compare against")
    sys.exit()
width, height, ratio = (float(n) for n in page.groups())

sizes, ratios = [], []
for line in open(sys.argv[1]):
    if not line.startswith("said: "):
        continue
    message = json.loads(line[len("said: "):])
    if message.get("type") == "set_desktop_size":
        sizes.append(tuple(message["size"]))
    elif message.get("type") == "set_device_pixel_ratio":
        ratios.append(message["ratio"])

if (width, height) != (900, 700):
    print("the page is %gx%g in a 900x700 window, so the browser laid something out over the desktop -- an infobar, if it is 56px short" % (width, height))
elif ratio != 2:
    print("the page measured a density of %g where --force-device-scale-factor=2 was asked for, so a report of 1 could pass by coincidence" % ratio)
elif not sizes:
    print("the compositor never heard set_desktop_size, so the engine does not report the desktop's size and a shell that does not is a desktop at the placeholder")
elif sizes[-1] != (width, height):
    print("the compositor heard the desktop is %gx%g where the page measures %gx%g" % (sizes[-1] + (width, height)))
elif not ratios:
    print("the compositor never heard set_device_pixel_ratio, so the engine does not report the density and every client draws at 1x")
elif ratios[-1] != ratio:
    print("the compositor heard a density of %g where the page measures %g" % (ratios[-1], ratio))
PY
)

echo "page: ${GEOMETRY:-none}"
grep -E 'set_desktop_size|set_device_pixel_ratio' "$SOCKET_LOG" || true

if [ -n "$FAILURE" ]; then
  annotate_from "guard-desktop-geometry: $FAILURE" "$ENGINE_LOG"
  echo "guard-desktop-geometry: $FAILURE" >&2
  echo "the compositor stand-in said:" >&2
  tail -20 "$SOCKET_LOG" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
fi
echo "PASS: the engine reports the desktop's size and density with no help from the page"
