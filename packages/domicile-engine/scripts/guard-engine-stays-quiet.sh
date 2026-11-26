#!/usr/bin/env bash
# Checks that an idle engine asks Google only for the components a page needs.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-engine-stays-quiet.sh /build/chromium/src
#
# Patch 0291. Starts the engine with a fresh profile and component updates on,
# as `domicile` starts it, records its network log for FOR_SECONDS, and fails
# on:
#
# - a component download other than KEPT's (the ids are in the download URLs),
# - the network time service (`/time/1/current`),
# - the AI Mode eligibility check (`/async/folae`),
# - a preconnect to the search engine (`https://www.google.com/` alone).
#
# The control is in the same run: the log must hold an update check
# (`/service/update2`), which proves the updater ran and the log records
# requests. A request is logged when it starts, so a build machine with no
# route to Google still sees each one.
#
# Headless, with no compositor or client.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-engine-stays-quiet: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-stays-quiet-broker}"
PROFILE="${PROFILE:-/tmp/domicile-stays-quiet-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-stays-quiet-engine.log}"
NET_LOG="${NET_LOG:-/tmp/domicile-stays-quiet-net.json}"
# The updater's first check comes about a minute after start, later on a
# busy runner; its downloads follow within seconds.
FOR_SECONDS="${FOR_SECONDS:-240}"
AFTER_CHECK_SECONDS="${AFTER_CHECK_SECONDS:-30}"

# The components patch 0291 keeps, by id: CRLSet, PKI metadata, origin
# trials, the autoplay preload list, hyphenation, Screen AI and Widevine.
KEPT=(
  hfnkpimlhhgieaddgfemjhofmfblmnib
  efniojlnjndmcbiieegkicadnoecjjef
  llkgjffcdpffmhiakmfcdcblohccpfmo
  laoigpblnllgcgjnjnllmfolckpjlhki
  jamhcnnkihinmdlkakkaopbjbbcngflc
  mfhmdacoffpmifoibamicehhklffanao
  oimompecagnajdejgnnjijobebaeigek
)

# component updates on: the updater's requests are what this guard measures.
# Its downloads land in the engine's TMPDIR, 85-195M of them, so the engine
# gets one of its own that cleanup removes.
ENGINE_TMP="${ENGINE_TMP:-/tmp/domicile-stays-quiet-tmp}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
  rm -rf "$ENGINE_TMP"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-engine-stays-quiet: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}

fresh_broker
rm -rf "$PROFILE"; mkdir -p "$PROFILE"
rm -f "$ENGINE_LOG" "$NET_LOG"

rm -rf "$ENGINE_TMP"; mkdir -p "$ENGINE_TMP"
TMPDIR="$ENGINE_TMP" "$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-engine-stays-quiet.js" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --log-net-log="$NET_LOG" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
ENGINE=$!
STARTED+=("$ENGINE")

# Until the updater's check is in the log, then long enough for what it
# answers to be downloaded. The log is written as the engine goes.
for _ in $(seq 1 "$FOR_SECONDS"); do
  grep -qF "/service/update2" "$NET_LOG" 2>/dev/null && break
  sleep 1
done
sleep "$AFTER_CHECK_SECONDS"
# The net log is written out as the engine exits.
kill "$ENGINE" 2>/dev/null
for _ in $(seq 1 80); do
  kill -0 "$ENGINE" 2>/dev/null || break
  sleep 0.25
done

# Every URL the engine asked for, without its query.
URLS=$(grep -oE '"url":"https?://[^"?]*' "$NET_LOG" 2>/dev/null | cut -c8- | sort -u)
# Its component downloads: whole ones end `.crx3`, differential ones are
# under `/diffgen-puffin/`.
DOWNLOADS=$(grep -E '\.crx3$|/diffgen-puffin/' <<<"$URLS")

FAILURE=""
grep -qF "GUARD quiet ready" "$ENGINE_LOG" ||
  FAILURE="the shell never ran, or ran and never said so"
[ -z "$FAILURE" ] && ! grep -qF "/service/update2" <<<"$URLS" &&
  FAILURE="the control failed: the net log holds no update check, so the updater never ran or the log records nothing"
# Each download names its component's id in its path. One that names no id
# is a component nobody kept.
while read -r url; do
  [ -n "$FAILURE" ] || [ -z "$url" ] && break
  id=$(grep -oE '/[a-p]{32}[/_]' <<<"$url" | head -1 | cut -c2-33)
  printf '%s\n' "${KEPT[@]}" | grep -qxF "${id:-none}" ||
    FAILURE="the engine downloaded a component patch 0291 does not keep (CrxUpdateService::RegisterComponent's list): $url"
done <<<"$DOWNLOADS"
[ -z "$FAILURE" ] && grep -qF "/time/1/current" <<<"$URLS" &&
  FAILURE="the engine asked Google for the time: kNetworkTimeServiceQuerying is on"
[ -z "$FAILURE" ] && grep -qF "/async/folae" <<<"$URLS" &&
  FAILURE="the engine asked Google whether AI Mode is offered: kAimEnabled is on"
# A preconnect has the bare origin as its URL.
[ -z "$FAILURE" ] && grep -qxF "https://www.google.com/" <<<"$URLS" &&
  FAILURE="the engine connected to the search engine before anyone searched: kPreconnectToSearch is on, by its default or the field trial testing config's PreconnectToSearchDesktop study"

echo "asked for:"
while read -r url; do echo "  $url"; done <<<"$URLS"

if [ -n "$FAILURE" ]; then
  annotate_from "guard-engine-stays-quiet: $FAILURE" "$ENGINE_LOG"
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  # Last, so a summary that keeps a check's last lines keeps these.
  echo "the net log is $(wc -c <"$NET_LOG" 2>/dev/null || echo "missing, 0") bytes and asked for:" >&2
  while read -r url; do echo "  $url"; done <<<"$URLS" >&2
  echo "guard-engine-stays-quiet: $FAILURE" >&2
  exit 1
fi
echo "PASS: an idle engine asks Google only for the components a page needs"
