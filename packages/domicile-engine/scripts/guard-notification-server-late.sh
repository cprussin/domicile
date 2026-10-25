#!/usr/bin/env bash
# Checks that the browser uses a notification server that takes its name after
# the browser looked for one.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-notification-server-late.sh /build/chromium/src
#
# WHY THIS EXISTS. Domicile starts the engine before the compositor, which
# serves `org.freedesktop.Notifications`. Chrome's bridge looked for the server
# once, so it could miss it and show its own popups all session. Patch 0133
# has it wait for the name.
#
# Headless, on a private bus with no activatable services. The shell shows a
# notification at once. Once the engine has asked the bus about the name,
# `dbus-test-tool echo` takes it. Passes when `dbus-monitor` sees the engine
# call `GetCapabilities` on it, which is the bridge connecting.
#
# NEGATIVE=1 runs two legs:
#
#   1. a server there before the engine must be called, proving the monitor
#      sees the call
#   2. with no server, nothing may be called, proving the call needs a server
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-notification-server-late: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# How long the engine has to start and ask about the name.
FOR_SECONDS="${FOR_SECONDS:-60}"
# How long the server waits to be called. Under patch 0133's 20 second wait,
# so the no-server leg ends before the bridge gives up.
READ_SECONDS="${READ_SECONDS:-15}"

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-notification-server-late-broker}"
PROFILE="${PROFILE:-/tmp/domicile-notification-server-late-profile}"
BUS="${BUS:-/tmp/domicile-notification-server-late-bus}"
BUS_CONFIG="${BUS_CONFIG:-/tmp/domicile-notification-server-late-bus.conf}"

NAME="org.freedesktop.Notifications"
LAST_ENGINE_LOG=""
LAST_MONITOR_LOG=""

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
  rm -f "$BUS" "$BUS_CONFIG"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-notification-server-late: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
for tool in dbus-daemon dbus-monitor dbus-test-tool; do
  command -v "$tool" >/dev/null || {
    skip "guard-notification-server-late: no $tool here; run inside nix develop .#full"
    exit 77
  }
done

# No <servicedir>: a notification daemon installed on the host must not be
# started in the server's place.
cat >"$BUS_CONFIG" <<EOF
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:path=$BUS</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
EOF

wait_for_line() { # $1 seconds, $2 pattern, $3 file
  for _ in $(seq 1 $(($1 * 4))); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# Starts the notification server on the leg's bus.
serve() {
  dbus-test-tool echo --name="$NAME" >/dev/null 2>&1 &
  STARTED+=($!)
  LEG+=($!)
}

# Runs the engine on a fresh bus and sets READING to what the monitor saw:
#
#   called   the engine called GetCapabilities on the server
#   silent   it did not
#   unasked  it never asked the bus about the name (the late and none legs)
#   nobus    the bus or the monitor never came up
measure() { # $1 when the server starts: late, early or none
  local when="$1"
  local engine_log="/tmp/domicile-notification-server-late-$when-engine.log"
  local monitor_log="/tmp/domicile-notification-server-late-$when-monitor.log"
  local daemon_log="/tmp/domicile-notification-server-late-$when-daemon.log"
  LAST_ENGINE_LOG="$engine_log"
  LAST_MONITOR_LOG="$monitor_log"
  LEG=()

  fresh_broker
  rm -rf "$PROFILE"
  mkdir -p "$PROFILE"
  rm -f "$BUS"

  rm -f "$daemon_log"
  dbus-daemon --config-file="$BUS_CONFIG" --nofork --nopidfile >"$daemon_log" 2>&1 &
  STARTED+=($!)
  LEG+=($!)
  for _ in $(seq 1 40); do
    [ -S "$BUS" ] && break
    sleep 0.25
  done
  [ -S "$BUS" ] || {
    READING="nobus"
    return
  }
  export DBUS_SESSION_BUS_ADDRESS="unix:path=$BUS"

  rm -f "$monitor_log"
  dbus-monitor --session >"$monitor_log" 2>&1 &
  STARTED+=($!)
  LEG+=($!)
  wait_for_line 10 "NameAcquired" "$monitor_log" || {
    READING="nobus"
    return
  }

  [ "$when" = "early" ] && serve

  rm -f "$engine_log"
  "$CHROMIUM/$OUT/chrome" \
    --ozone-platform=headless \
    --disable-gpu \
    --app="domicile://shell/" \
    --domicile-shell-root="$SCRIPTS" \
    --domicile-shell-module="guard-notification-server-late.js" \
    --no-sandbox --password-store=basic --no-first-run --disable-component-update \
    --user-data-dir="$PROFILE" \
    --enable-logging=stderr --log-level=0 \
    --domicile-broker-socket="$BROKER" >"$engine_log" 2>&1 &
  STARTED+=($!)
  LEG+=($!)

  if [ "$when" = "early" ]; then
    wait_for_line "$FOR_SECONDS" "member=GetCapabilities" "$monitor_log" &&
      READING="called" || READING="silent"
  elif ! wait_for_line "$FOR_SECONDS" "string \"$NAME\"" "$monitor_log"; then
    READING="unasked"
  else
    [ "$when" = "late" ] && serve
    wait_for_line "$READ_SECONDS" "member=GetCapabilities" "$monitor_log" &&
      READING="called" || READING="silent"
  fi

  kill "${LEG[@]}" 2>/dev/null
}

if [ "$NEGATIVE" = "1" ]; then
  measure early
  EARLY="$READING"
  measure none
  MEASURED="control $EARLY $READING"
else
  measure late
  MEASURED="late $READING"
fi

echo
echo "measured: $MEASURED"

# packages/domicile-engine/tests/test-notification-server-late-guard.sh runs this block directly.
FAILURE=""
PASSED=""
case "$MEASURED" in
"late called")
  PASSED="the browser connected to a notification server that took its name \
after the browser looked, so a compositor that starts after the engine serves \
its notifications"
  ;;
"late silent")
  FAILURE="the browser looked for a notification server before there was one \
and never called the one that came: its bridge looks once (patch 0133), so a \
compositor that starts after the engine never sees a site's notifications"
  ;;
"late unasked")
  FAILURE="the engine never asked the bus about $NAME, so its notification \
bridge did not start: the shell's notification was refused or never shown. \
This is the harness, not the bridge"
  ;;
"control called silent")
  PASSED="the control is sharp: a server there from the start was called, and \
none was called without one, so the claim's call is the bridge reaching the \
late server"
  ;;
"control called called")
  FAILURE="GetCapabilities was called on a bus with no notification server, so \
the call says nothing about reaching one"
  ;;
"control called unasked")
  FAILURE="the no-server leg's engine never asked about $NAME, so nothing was \
measured against the first leg. This is the harness"
  ;;
"control silent "* | "control unasked "*)
  FAILURE="the control's first leg saw no call to a server that was there \
before the engine, so this monitor cannot see the call and a silent one proves \
nothing"
  ;;
*)
  FAILURE="there is no measurement here of any kind ($MEASURED) -- the bus or \
the monitor never came up, or a leg read something this guard does not know"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-notification-server-late: $FAILURE"
if [ -n "$LAST_ENGINE_LOG" ]; then
  echo "the engine's last words ($LAST_ENGINE_LOG):" >&2
  last_words "$LAST_ENGINE_LOG" >&2
fi
if [ -n "$LAST_MONITOR_LOG" ]; then
  echo "what the bus carried ($LAST_MONITOR_LOG):" >&2
  tail -40 "$LAST_MONITOR_LOG" >&2
fi
exit 1
