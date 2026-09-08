#!/usr/bin/env bash
# Which ozone platform a desktop takes, and why that is a question about where
# it was started.
#
# The engine carries wayland, drm and headless and picks one at runtime, so a
# desktop is a window inside an existing session or a session of its own
# depending on what is already running — the way any other compositor behaves.
# Getting it wrong is not a small thing in either direction: `wayland` with no
# compositor is a startup failure, and `drm` with one running is an attempt to
# take KMS out from under it.
#
# Run out of the real script rather than copied, so a rewrite that moves it
# fails here loudly instead of leaving this passing against a version nobody
# ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$ROOT/scripts/run-engine.sh"

BLOCK="$(awk '/^if \[ -n "\$\{OZONE:-\}" \]; then$/,/^echo "the engine is taking/' \
  "$SCRIPT_UNDER_TEST")"
[ -n "$BLOCK" ] || {
  echo "no platform choice in $SCRIPT_UNDER_TEST — its markers moved." >&2
  exit 1
}

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

# The block `exit 1`s when it refuses, which ends the subshell it runs in, so
# the report has to be inside that subshell and the refusal read off its status.
platform() { # $1 OZONE, $2 WAYLAND_DISPLAY, $3 DISPLAY
  local out
  if out="$( (
      OZONE="$1"
      WAYLAND_DISPLAY="$2"
      DISPLAY="$3"
      eval "$BLOCK" >/dev/null
      echo "$PLATFORM"
    ) 2>/dev/null )"; then
    echo "$out"
  else
    echo "refused"
  fi
}

# A compositor is already running, so a desktop is a window inside it — which
# is what starting sway inside sway does.
expect "a Wayland session gets a window" "wayland" \
  "$(platform "" "wayland-0" "")"

# A TTY IS REFUSED, and this is the case the answer changed on. It used to be
# `drm` — the whole screen, chrome taking KMS itself — and `drm` cannot be
# built at this Chromium pin: `ozone_platform_drm` fails `gn gen` on
# `assert(is_chromeos, ...)`. Passing it anyway hands a binary a platform name
# it does not have, which is a black screen and a Chromium fatal rather than a
# desktop, so the refusal says the true thing and points at the finding.
expect "a tty is refused, because drm is not built" "refused" \
  "$(platform "" "" "")"

# THE CASE THIS EXISTS FOR. "No WAYLAND_DISPLAY" is not the same fact as "there
# is no display server", and reading it as one sent an X11 user to `drm`, which
# is an attempt to take KMS out from under a running X server.
expect "an X11 session is refused, not sent to drm" "refused" \
  "$(platform "" "" ":0")"

# A Wayland session inside which X is also reachable — XWayland sets DISPLAY,
# so both are set and Wayland is still the answer.
expect "Wayland wins when both are set" "wayland" \
  "$(platform "" "wayland-0" ":0")"

# The override is what makes headless reachable: no environment variable says
# "this machine has no display at all", which is what CI has.
expect "an explicit platform overrides everything" "headless" \
  "$(platform "headless" "wayland-0" ":0")"

expect "an explicit platform overrides an X11 refusal" "headless" \
  "$(platform "headless" "" ":0")"

# And overrides the tty refusal, so the day the series carries a drm patch,
# `OZONE=drm` is how somebody tries it without editing this file.
expect "an explicit platform overrides the tty refusal" "drm" \
  "$(platform "drm" "" "")"

# WHAT THE DECISION IS FOR. Every case above reads `$PLATFORM` out of the
# block, and a block that decides correctly and is then ignored decides
# nothing: reverting the launch to `--ozone-platform="${OZONE:-wayland}"` left
# all of them green while the engine took wayland and the run said "drm".
#
# Read out of the file rather than run, because running it means starting
# Chromium. What it establishes is that the flag the decision produces is the
# flag the engine is given, which is the whole of the connection.
LAUNCH="$(awk '/^# 2\. The engine, on that page\.$/,/^STARTED\+=/' \
  "$SCRIPT_UNDER_TEST")"
[ -n "$LAUNCH" ] || {
  echo "no engine launch in $SCRIPT_UNDER_TEST — its markers moved." >&2
  exit 1
}

expect "the engine is given the platform that was decided" "yes" \
  "$(printf '%s\n' "$LAUNCH" | grep -q -- '--ozone-platform="\$PLATFORM"' &&
       echo yes || echo no)"

# `--app` is what makes it a desktop rather than a browser looking at a page,
# and it is the one thing in this file with no runtime check anywhere: the
# pixel guards find the client's window whether or not there is a tab strip
# above it. Deleting the flag used to leave every case here green.
expect "the engine is given the page as an app, not as a tab" "yes" \
  "$(printf '%s\n' "$LAUNCH" | grep -q -- '--app="\$URL"' &&
       echo yes || echo no)"

# And the URL is not also passed positionally, which would open a second
# window — a tab-stripped app window and an ordinary browser one.
expect "the page is not opened twice" "yes" \
  "$(printf '%s\n' "$LAUNCH" | grep -qE '^\s*"\$URL"' && echo no || echo yes)"

# NO `--enable-blink-features`, and this is a flag whose absence is the
# feature. Patch 0006 took `DomicileExternalSurface` to `status: "stable"`, so
# passing it enables nothing — but `switches::kEnableBlinkFeatures` is in
# `bad_flags_prompt.cc`, so any value of it puts "You are using an unsupported
# command-line flag" across the top of the desktop, next to the one the sandbox
# used to draw. Nothing else in this repository would notice it coming back:
# the pixel guards find the client's window whether or not there is a yellow
# bar above it, which is exactly how it survived being unnecessary.
expect "the engine is not given a flag that banners the desktop" "yes" \
  "$(printf '%s\n' "$LAUNCH" | grep -qE '^\s*--enable-blink-features' &&
       echo no || echo yes)"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
