#!/usr/bin/env bash
# Checks that the engine plays H.264 video and AAC audio, which most sites'
# `<video>` serves.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-video-codecs.sh /build/chromium/src
#
# Chromium builds them only with `proprietary_codecs`, which
# `src/build/args/domicile_codecs.gn` sets. Without it, an MP4 fails with
# `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`. Its control is in the same run: VP9,
# which every build plays, must answer `probably`, so the page can see a codec.
#
# Headless, with no compositor or client.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-video-codecs: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-video-codecs-broker}"
PROFILE="${PROFILE:-/tmp/domicile-video-codecs-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-video-codecs-engine.log}"
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
  annotate "guard-video-codecs: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-video-codecs.js" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

# No early exit when it never comes: the verdict below says why, with the
# engine's log.
for _ in $(seq 1 $((FOR_SECONDS * 4))); do
  grep -qF "GUARD codecs " "$ENGINE_LOG" 2>/dev/null && break
  sleep 0.25
done

# The closing quote is Chromium's and keeps each match on the message: see
# guard-windows-state.sh.
MEASURED=$(grep -oE '"GUARD codecs [^"]*"' "$ENGINE_LOG" | head -1)

case "$MEASURED" in
'"GUARD codecs aac=probably h264=probably vp9=probably"')
  FAILURE=""
  ;;
"")
  FAILURE="the shell never ran, or ran and never said so: DomicileShell did not run the module, or the module was refused"
  ;;
*'vp9=probably"')
  FAILURE="the engine does not play H.264 or AAC ($MEASURED): it was built without proprietary_codecs (src/build/args/domicile_codecs.gn), so most sites' <video> fails"
  ;;
*)
  FAILURE="the control failed ($MEASURED): VP9, which every build plays, was refused, so this page cannot see a codec"
  ;;
esac

echo "page: $MEASURED"

if [ -n "$FAILURE" ]; then
  annotate_from "guard-video-codecs: $FAILURE" "$ENGINE_LOG"
  echo "guard-video-codecs: $FAILURE" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
fi
echo "PASS: the engine plays H.264 and AAC, and VP9"
