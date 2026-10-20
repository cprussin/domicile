#!/usr/bin/env bash
# Checks a <webview>'s `partition` keeps its storage apart from the user's and
# from other partitions, keeps a `persist:` partition across a restart, and
# keeps any other one in memory.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-partition.sh /build/chromium/src
#
# Headless and software-composited: nothing is measured in pixels.
#
# A `<webview partition>` and a window from `openBrowserWindow(url, partition)`
# get a guest SiteInstance in their own StoragePartition (ParamsFor in
# web_view_guest.cc). The engine runs twice on one profile, and the page server
# stays up, so both runs see one origin.
#
# Asserts, in order (each only meaningful if the previous holds):
#
#   the shell ran and both writers        a key is in `persist:guard` and
#   reported                              another in `guard`
#   a reader in `persist:guard` has its   the key was stored, so its absence
#   key and only its key                  elsewhere means something
#   a reader in no partition has neither  the claim: partitions are apart from
#                                         the user's storage
#   a reader in `guard` has only its key  and from each other
#   the window is listed in               the shell can tell
#   `persist:guard` and has its key
#   after a restart, `persist:guard`      it was kept on disk
#   still has its key
#   and `guard` has none                  it was kept in memory
#
# NEGATIVE=1 sets no partition anywhere. Every reader, the window and both
# restarted readers must have both keys, so a run where reads fail, or where
# nothing outlives a restart, cannot pass.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-partition: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 sets no partition. See the header.
NEGATIVE="${NEGATIVE:-0}"
PARTITIONED=1
[ "$NEGATIVE" = "1" ] && PARTITIONED=0

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-partition-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-partition-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# Time for each run's shell to load, make its guests and load a page in each.
# Generous because every step is asynchronous and the machine is shared.
FOR_SECONDS="${FOR_SECONDS:-90}"

WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-partition$WHICH-engine.log}"
RESTART_LOG="${ENGINE_LOG%.log}-restart.log"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-partition$WHICH-http.log}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-partition: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-partition: no python3, and the pages are served by one"
  exit 77
}

rm -rf "$PROFILE"
mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The writer and reader pages, up for both runs.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-partition-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-partition: its page server never came up" "$HTTP_LOG"
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-partition: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SITE="http://127.0.0.1:$PORT"
echo "writing at $SITE, partitioned=$PARTITIONED"

# Runs the engine on the profile with the module's `leg` until it says done,
# crashes or runs out of time, then stops it. On a domicile:// document,
# because the browser binds WebViewGuestHost only for that origin.
run_leg() { # $1 leg, $2 log
  fresh_broker
  rm -f "$2"
  "$CHROMIUM/$OUT/chrome" \
    --ozone-platform=headless \
    --disable-gpu \
    --app="domicile://shell/?site=$SITE&leg=$1&partitioned=$PARTITIONED" \
    --domicile-shell-root="$SCRIPTS" \
    --domicile-shell-module="guard-webview-partition.js" \
    --no-sandbox --password-store=basic --no-first-run --disable-component-update \
    --user-data-dir="$PROFILE" \
    --window-size="$WIDTH,$HEIGHT" \
    --enable-logging=stderr --log-level=0 \
    --domicile-broker-socket="$BROKER" >"$2" 2>&1 &
  local engine=$!
  STARTED+=("$engine")
  for _ in $(seq 1 $((FOR_SECONDS * 4))); do
    grep -qE "GUARD (done|failed)|Received signal" "$2" 2>/dev/null && break
    sleep 0.25
  done
  # The restart needs the profile's lock back, so wait for the browser to go.
  kill "$engine" 2>/dev/null
  for _ in $(seq 1 80); do
    kill -0 "$engine" 2>/dev/null || return 0
    sleep 0.25
  done
  kill -9 "$engine" 2>/dev/null
}

# 2. The first run writes and reads; the restart reads again.
rm -f "$RESTART_LOG"
run_leg first "$ENGINE_LOG"
grep -qF "GUARD done" "$ENGINE_LOG" && run_leg restart "$RESTART_LOG"

saw() { # $1 pattern, $2 log
  grep -qF "$1" "$2" 2>/dev/null && echo 1 || echo 0
}
# The keys reader `$1` reported, or nothing if it never read.
keys_of() { # $1 reader
  sed -n "s/^GUARD read as=$1 keys=\([^ ]*\)\$/\1/p" "$HTTP_LOG" | head -1
}

SAW_SHELL=$(saw "GUARD shell-loaded" "$ENGINE_LOG")
SAW_CRASH=$(cat "$ENGINE_LOG" "$RESTART_LOG" 2>/dev/null | grep -qF "Received signal" && echo 1 || echo 0)
SAW_WROTE=$(grep -qF "GUARD wrote as=writer" "$HTTP_LOG" &&
  grep -qF "GUARD wrote as=memorywriter" "$HTTP_LOG" && echo 1 || echo 0)
SAME_KEYS="$(keys_of same)"
DEFAULT_KEYS="$(keys_of default)"
MEMORY_KEYS="$(keys_of memory)"
WINDOW_PARTITION="$(sed -n 's/^.*GUARD window id=[^ ]* partition=\([^ "]*\).*$/\1/p' "$ENGINE_LOG" | head -1)"
SAW_WINDOW=$(saw "GUARD window id=" "$ENGINE_LOG")
WINDOW_KEYS="$(keys_of window)"
SAW_RESTART=$(saw "GUARD shell-loaded" "$RESTART_LOG")
RESTARTED_KEYS="$(keys_of restarted)"
RESTARTED_MEMORY_KEYS="$(keys_of restartedmemory)"
# WebViewGuest's own line for a partitioned guest. Diagnostic only.
SAW_MADE=$(saw "domicile: made a guest in partition" "$ENGINE_LOG")

echo
echo "shell=$SAW_SHELL wrote=$SAW_WROTE crash=$SAW_CRASH made-partitioned=$SAW_MADE"
echo "readers: same=$SAME_KEYS default=$DEFAULT_KEYS memory=$MEMORY_KEYS"
echo "window: listed=$SAW_WINDOW partition=$WINDOW_PARTITION keys=$WINDOW_KEYS"
echo "restart: shell=$SAW_RESTART persist=$RESTARTED_KEYS memory=$RESTARTED_MEMORY_KEYS"
echo

# The verdict. `scripts/test-webview-partition-guard.sh` runs this block
# directly.
FAILURE=""
PASSED=""
BOTH="memory,persisted"
WANT_SAME="persisted"
WANT_DEFAULT="(none)"
WANT_MEMORY="memory"
WANT_WINDOW_PARTITION="persist:guard"
WANT_RESTARTED_MEMORY="(none)"
[ "$NEGATIVE" = "1" ] && {
  WANT_SAME="$BOTH"
  WANT_DEFAULT="$BOTH"
  WANT_MEMORY="$BOTH"
  WANT_WINDOW_PARTITION=""
  WANT_RESTARTED_MEMORY="$BOTH"
}
WANT_WINDOW="$WANT_SAME"
WANT_RESTARTED="$WANT_SAME"
if [ "$SAW_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was ever set up. This is \
the harness: the module did not load, or it threw, and the engine log has its \
console"
elif [ "$SAW_CRASH" = "1" ]; then
  FAILURE="a process dumped a signal. A partitioned guest has a guest \
SiteInstance, so suspect content's CHECKs on guests and patch 0115 first. \
Read the dumped stack"
elif [ "$SAW_WROTE" != "1" ]; then
  FAILURE="a writer's page never reported, so no key was stored and nothing \
was measured. That is the guest: it was not made, not attached, or not \
navigated. A partition the browser refused logs \"named partition\""
elif [ -z "$SAME_KEYS" ] || [ -z "$DEFAULT_KEYS" ] || [ -z "$MEMORY_KEYS" ]; then
  FAILURE="a reader's page never reported, so a missing key there is no \
reading. The shell starts the readers once both writers report; see \
guard-webview-partition.js"
elif [ "$SAME_KEYS" != "$WANT_SAME" ]; then
  FAILURE="a reader in the writer's storage has \"$SAME_KEYS\", not \
\"$WANT_SAME\", so the key was not stored where that side reads, and its \
absence elsewhere means nothing. Check ParamsFor makes one partition per name"
elif [ "$DEFAULT_KEYS" != "$WANT_DEFAULT" ]; then
  FAILURE="THE STORAGE CROSSED: a reader in no partition has \
\"$DEFAULT_KEYS\", not \"$WANT_DEFAULT\". A partitioned page shares the \
user's storage. Check the element sends \`partition\` and ParamsFor gives the \
guest a guest SiteInstance"
elif [ "$MEMORY_KEYS" != "$WANT_MEMORY" ]; then
  FAILURE="a reader in \`guard\` has \"$MEMORY_KEYS\", not \"$WANT_MEMORY\", \
so \`guard\` and \`persist:guard\` are one partition. Check ParamsFor passes \
in_memory for a name without the prefix"
elif [ "$SAW_WINDOW" != "1" ] || [ -z "$WINDOW_KEYS" ]; then
  FAILURE="the opened browser window never reached the shell's list or never \
read. That is DeskWindows::Make, BrowserWindowsClient, or the window's attach \
to the shell's <webview window>"
elif [ "$WINDOW_PARTITION" != "$WANT_WINDOW_PARTITION" ]; then
  FAILURE="the window is listed in partition \"$WINDOW_PARTITION\", not \
\"$WANT_WINDOW_PARTITION\", so the shell cannot tell where its page is. That \
is DeskWindows::List or WebViewGuest::partition"
elif [ "$WINDOW_KEYS" != "$WANT_WINDOW" ]; then
  FAILURE="the window's page has \"$WINDOW_KEYS\", not \"$WANT_WINDOW\", so \
it is not in the partition it was opened in. Check BrowserWindowsService::Open \
passes the partition to DeskWindows::Make"
elif [ "$SAW_RESTART" != "1" ] || [ -z "$RESTARTED_KEYS" ] ||
  [ -z "$RESTARTED_MEMORY_KEYS" ]; then
  FAILURE="the restarted engine never read, so whether a partition outlives \
the engine was not measured. The first run stops the engine once its shell \
says done; the profile's lock or a slow exit stops the second"
elif [ "$RESTARTED_KEYS" != "$WANT_RESTARTED" ]; then
  FAILURE="after a restart, \`persist:guard\` has \"$RESTARTED_KEYS\", not \
\"$WANT_RESTARTED\", so it was not kept on disk. Check ParamsFor passes \
in_memory false for the \`persist:\` prefix"
elif [ "$RESTARTED_MEMORY_KEYS" != "$WANT_RESTARTED_MEMORY" ]; then
  FAILURE="after a restart, \`guard\` has \"$RESTARTED_MEMORY_KEYS\", not \
\"$WANT_RESTARTED_MEMORY\", so a partition named without \`persist:\` was \
written to disk"
elif [ "$NEGATIVE" = "1" ]; then
  PASSED="the control is sharp: with no partition every reader, the window \
and both restarted readers have both keys"
else
  PASSED="each partition keeps its key from the user's storage and from the \
other; the window is listed and stored in its partition; \`persist:guard\` \
outlives a restart and \`guard\` does not"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-webview-partition: $FAILURE"
echo "what the engine died of, if it did:" >&2
cat "$ENGINE_LOG" "$RESTART_LOG" 2>/dev/null |
  grep -n -A45 -E "FATAL|Check failed|Received signal" | head -150 >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
