#!/usr/bin/env bash
# Checks that the engine starts the Settings app's native messaging host for
# the app, and that the host reads the config the desktop names.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-settings-host.sh /build/chromium/src
#
# - The fixture is the Settings app's own manifest
#   (`packages/app-settings/public/manifest.json`) with a worker,
#   `guard-settings-host-extension/background.js`, loaded with
#   `--load-extension`. It calls `connectNative("domicile.settings")` and sends
#   `read`.
# - The host manifest, written as `domicile` writes it (`domicile_launch::apps`):
#   the profile's `NativeMessagingHosts/domicile.settings.json`, allowing the
#   app's id alone.
# - The host is `target/debug/domicile-settings-host`, which
#   `scripts/engine-build-the-compositor.sh` builds. It asks
#   `guard-settings-host-desktop.py` for the files over `DOMICILE_SOCK`.
# - Headless: nothing is drawn.
# - Control (`NEGATIVE=1`): the manifest without its `key`, so the fixture has
#   another id. Chrome must refuse it and the host must not answer, or the
#   positive run's reply says nothing about `allowed_origins`.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-settings-host: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# The Settings app's id, fixed by its manifest's `key`.
# `scripts/test-settings-host-guard.sh` holds it to `domicile_launch::apps`.
readonly ID="acpgnhiblklkgbkcjgbabkcmdmchdphk"
# What the config holds, and so what the host must read back.
readonly CONFIG_TEXT='{"theme":{"mode":"dark"}}'

ROOT="$(cd "$SCRIPTS/../../.." && pwd)"
HOST="$ROOT/target/debug/domicile-settings-host"
APP_MANIFEST="$ROOT/packages/app-settings/public/manifest.json"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-settings-host-broker}"
PROFILE="${PROFILE:-/tmp/domicile-settings-host-profile}"
# The fixture, the config and the desktop's socket.
WORK="${WORK:-/tmp/domicile-settings-host-work}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
FOR_SECONDS="${FOR_SECONDS:-60}"

# A run and its control keep separate logs so a failure can compare them.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-settings-host$WHICH-engine.log}"
DESKTOP_LOG="${DESKTOP_LOG:-/tmp/domicile-settings-host$WHICH-desktop.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
    wait "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE" "$WORK"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-settings-host: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -x "$HOST" ] || {
  annotate "guard-settings-host: no host at $HOST; build it with scripts/engine-build-the-compositor.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-settings-host: no python3, and the desktop the host asks is one"
  exit 77
}

rm -f "$BROKER"
rm -rf "$PROFILE" "$WORK"
mkdir -p "$PROFILE/NativeMessagingHosts" "$WORK/extension"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The fixture, the config and the host's manifest.
cp "$SCRIPTS/guard-settings-host-extension/background.js" "$WORK/extension/"
python3 - "$APP_MANIFEST" "$WORK/extension/manifest.json" "$NEGATIVE" <<'PY'
import json, sys
source, target, negative = sys.argv[1:]
with open(source) as f:
    manifest = json.load(f)
manifest["background"] = {"service_worker": "background.js"}
if negative == "1":
    del manifest["key"]
with open(target, "w") as f:
    json.dump(manifest, f)
PY
printf '%s\n' "$CONFIG_TEXT" >"$WORK/domicile.json"
cat >"$PROFILE/NativeMessagingHosts/domicile.settings.json" <<EOF
{"name":"domicile.settings","description":"Reads and writes the desktop's config for the Settings app","path":"$HOST","type":"stdio","allowed_origins":["chrome-extension://$ID/"]}
EOF

# 2. The desktop the host asks for the files.
rm -f "$DESKTOP_LOG"
python3 "$SCRIPTS/guard-settings-host-desktop.py" \
  --socket "$WORK/desktop.sock" --config "$WORK/domicile.json" >"$DESKTOP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 60 "listening" "$DESKTOP_LOG" || {
  annotate_from "guard-settings-host: its desktop never came up" "$DESKTOP_LOG"
  exit 1
}

# 3. The engine. Chrome passes its environment to the host.
rm -f "$ENGINE_LOG"
DOMICILE_SOCK="$WORK/desktop.sock" "$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?witness=000000&src=about:blank" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-content-script.js" \
  --disable-features=DisableLoadExtensionCommandLineSwitch \
  --load-extension="$WORK/extension" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
for _ in $(seq 1 "$TRIES"); do
  grep -qE "GUARD (reply|disconnected)" "$ENGINE_LOG" 2>/dev/null && break
  sleep 0.25
done

saw() { # $1 pattern
  grep -qF "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

SAW_WORKER=$(saw "GUARD connecting")
SAW_REPLY=$(saw "GUARD reply id=1 type=files config=$CONFIG_TEXT")
SAW_FORBIDDEN=$(saw "GUARD disconnected Access to the specified native messaging host is forbidden.")

echo
echo "worker=$SAW_WORKER reply=$SAW_REPLY forbidden=$SAW_FORBIDDEN"
grep -F "GUARD" "$ENGINE_LOG" | tail -3
echo

# The verdict. `scripts/test-settings-host-guard.sh` runs this block.
FAILURE=""
PASSED=""
if [ "$SAW_WORKER" != "1" ]; then
  FAILURE="the fixture's worker never ran: the harness did not load the \
extension, or its manifest was refused"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$SAW_REPLY" = "1" ]; then
    FAILURE="the host answered an extension that is not $ID, so the positive \
run's reply says nothing"
  elif [ "$SAW_FORBIDDEN" != "1" ]; then
    FAILURE="Chrome did not refuse an extension that is not $ID as forbidden"
  else
    PASSED="an extension without the app's key may not start the host"
  fi
elif [ "$SAW_FORBIDDEN" = "1" ]; then
  FAILURE="Chrome refused the Settings app: allowed_origins does not name \
chrome-extension://$ID/, or the app's key no longer gives it that id"
elif [ "$SAW_REPLY" != "1" ]; then
  FAILURE="read never came back with the config: Chrome did not start \
domicile-settings-host, or it failed. Its stderr is in the engine log"
else
  PASSED="the engine starts domicile-settings-host for the app, and it reads \
the config the desktop names"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-settings-host: $FAILURE"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
