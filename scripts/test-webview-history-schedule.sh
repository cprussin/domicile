#!/usr/bin/env bash
# How the history guard's module paces itself, against a browser in miniature.
#
# Each step waits for what it needs to have happened, bounded by a timeout, so a
# healthy engine runs in seconds and a broken one falls back to the bounds —
# which are the fixed schedule this replaced, and so the same readings.
#
# Runs the real `guard-webview-history.js` under bun with a fake <webview>: each
# navigation starts loading, commits and finishes LATENCY ms apart, announcing
# as the engine does, and `/slow` is held for SLOW_MS unless stopped.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODULE="$ROOT/packages/domicile-engine/scripts/guard-webview-history.js"
[ -f "$MODULE" ] || {
  echo "no module at $MODULE" >&2
  exit 1
}
command -v bun >/dev/null 2>&1 || {
  echo "SKIP: no bun to run the history guard's module with"
  exit 77
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
HARNESS="$WORK/harness.js"
cat >"$HARNESS" <<'EOF'
// argv: module, query, behavior (healthy | dead), slow ms, cap ms.
const [modulePath, query, behavior, slowMs, capMs] = process.argv.slice(2);
const LATENCY = 20;
const started = performance.now();
const log = (line) => {
  process.stdout.write(`${Math.round(performance.now() - started)} ${line}\n`);
  if (line.includes("GUARD done")) {
    process.exit(0);
  }
};

const listeners = new Map();
const announce = (type) => {
  for (const listener of listeners.get(type) ?? []) {
    listener();
  }
};
let entries = [];
let index = -1;
let inFlight;
const view = {
  addEventListener: (type, listener) => {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  },
  canGoBack: false,
  canGoForward: false,
  goBack: () => go(entries[index - 1], () => { index -= 1; }),
  goForward: () => go(entries[index + 1], () => { index += 1; }),
  loading: false,
  reload: () => go(entries[index], () => {}),
  security: "",
  setAttribute: (name, value) => {
    const path = new URL(value).pathname;
    go(path, () => {
      entries = [...entries.slice(0, index + 1), path];
      index += 1;
    });
  },
  stop: () => {
    if (inFlight !== undefined) {
      clearTimeout(inFlight);
      inFlight = undefined;
      log("fixture abandoned /slow");
      setLoading(false);
    }
  },
  style: {},
  url: "",
};

const setLoading = (value) => {
  if (view.loading !== value) {
    view.loading = value;
    announce("domicile-loading-change");
  }
};

// Start, commit, finish: the order the engine reports them in.
const go = (path, commit) => {
  if (behavior === "healthy" || behavior === "pending-url") {
    // The engine reports the visible entry, which a browser-initiated
    // navigation makes pending before its load has even started.
    if (behavior === "pending-url") {
      view.url = `http://fixture${path}`;
    }
    setTimeout(() => {
      setLoading(true);
      if (path === "/slow") {
        log("fixture asked /slow");
      }
      inFlight = setTimeout(
        () => {
          inFlight = undefined;
          commit();
          const can = [index > 0, index < entries.length - 1];
          if (can[0] !== view.canGoBack || can[1] !== view.canGoForward) {
            [view.canGoBack, view.canGoForward] = can;
            announce("domicile-history-change");
          }
          view.url = `http://fixture${path}`;
          view.security = "neutral";
          setTimeout(() => {
            log(`GUARD guest-shown path=${path}`);
            setLoading(false);
          }, LATENCY);
        },
        path === "/slow" ? Number(slowMs) : LATENCY,
      );
    }, LATENCY);
  }
};

globalThis.location = { search: `?${query}` };
globalThis.document = {
  body: { append: () => {} },
  createElement: () => view,
};
console.log = log;
setTimeout(() => {
  log("TIMEOUT");
  process.exit(0);
}, Number(capMs));
await import(modulePath);
EOF

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

SLOW_MS=600
run() { # $1 behavior, $2 drive, $3 settle, $4 step, $5 quiet, $6 hold, $7 cap
  bun "$HARNESS" "$MODULE" \
    "drive=$2&src=http://fixture&settle=$3&step=$4&quiet=$5&hold=$6" \
    "$1" "$SLOW_MS" "$7" 2>&1
}
# The ms at which the first line holding $2 was said, or nothing.
when() { # $1 output, $2 text
  printf '%s\n' "$1" | awk -v text="$2" 'index($0, text) { print $1; exit }'
}
has() { # $1 output, $2 text
  case "$1" in *"$2"*) echo yes ;; *) echo no ;; esac
}
shown() { # $1 output
  printf '%s\n' "$1" | sed -n 's/^.*GUARD guest-shown path=//p' | tr '\n' ' '
}
at_least() { # $1 ms, $2 minimum
  if [ -n "$1" ] && [ "$1" -ge "$2" ]; then echo yes; else echo no; fi
}

# Bounds far above what a healthy step takes, and a cap below the first of them:
# a run that sat out any bound never finishes.
POSITIVE="$(run healthy history 3000 2000 200 100 2900)"
echo "the positive run, on a healthy engine"
expect "finishes without sitting out a bound" "no" "$(has "$POSITIVE" TIMEOUT)"
expect "the guest showed the five pages" "/one /two /one /two /two " \
  "$(shown "$POSITIVE")"
expect "the first page has nowhere to go" "yes" \
  "$(has "$POSITIVE" "history-state at=start can=false/false events=0")"
expect "two pages is read once /two is there, and before any listener" "yes" \
  "$(has "$POSITIVE" "history-state at=two-pages can=true/false events=0")"
expect "after-back is read once the guest is back" "yes" \
  "$(has "$POSITIVE" "page-state at=after-back path=/one")"
expect "after-back is read once back's answer is in" "yes" \
  "$(has "$POSITIVE" "history-state at=after-back can=false/true")"
expect "after-forward is read once the guest is forward" "yes" \
  "$(has "$POSITIVE" "history-state at=after-forward can=true/false events=2")"
expect "settled is read once the reload has finished" "yes" \
  "$(has "$POSITIVE" "loading-state at=settled loading=false")"
expect "pending is read while /slow is held" "yes" \
  "$(has "$POSITIVE" "loading-state at=pending loading=true")"
expect "after-stop is read once the load is canceled" "yes" \
  "$(has "$POSITIVE" "loading-state at=after-stop loading=false")"
# The request has to be at the fixture before stop(), or there is nothing to
# cancel and `asked /slow` never appears.
ASKED="$(when "$POSITIVE" "fixture asked /slow")"
STOPPED="$(when "$POSITIVE" "GUARD calling stop")"
expect "stop() gives the pending load its hold first" "yes" \
  "$(at_least "$((${STOPPED:-0} - ${ASKED:-0}))" 100)"

CONTROL="$(run healthy none 3000 2000 200 100 2900)"
echo
echo "the control, on a healthy engine"
expect "finishes without sitting out a bound" "no" "$(has "$CONTROL" TIMEOUT)"
expect "the guest showed two pages and then the slow one" "/one /two /slow " \
  "$(shown "$CONTROL")"
# Nothing is driven, so there is nothing to wait for: the absence gets `quiet`.
NOT_BACK="$(when "$CONTROL" "GUARD not calling goBack")"
AFTER_BACK="$(when "$CONTROL" "history-state at=after-back")"
expect "an undriven step is watched for its quiet window" "yes" \
  "$(at_least "$((${AFTER_BACK:-0} - ${NOT_BACK:-0}))" 200)"
expect "back stays available with nothing driving it" "yes" \
  "$(has "$CONTROL" "history-state at=after-back can=true/false")"
expect "pending is read while /slow is held" "yes" \
  "$(has "$CONTROL" "loading-state at=pending loading=true")"
expect "the run waits for the slow page to arrive" "yes" \
  "$(has "$CONTROL" "loading-state at=after-stop loading=false")"

# The address changes before the load starts: no step may take that as arrived.
PENDING="$(run pending-url history 3000 2000 200 100 2900)"
echo
echo "an engine that shows an address before loading it"
expect "the guest showed the five pages" "/one /two /one /two /two " \
  "$(shown "$PENDING")"
expect "after-back is read once back's answer is in" "yes" \
  "$(has "$PENDING" "history-state at=after-back can=false/true")"
expect "after-forward is read once the guest is forward" "yes" \
  "$(has "$PENDING" "history-state at=after-forward can=true/false events=2")"

# Nothing ever arrives: every step sits out its bound, and every reading is
# still taken for the verdict to judge.
DEAD="$(run dead history 300 200 50 50 5000)"
echo
echo "an engine where nothing ever arrives"
expect "still finishes" "no" "$(has "$DEAD" TIMEOUT)"
expect "takes all four history readings" "4" \
  "$(printf '%s\n' "$DEAD" | grep -c "GUARD history-state")"
expect "takes all three loading readings" "3" \
  "$(printf '%s\n' "$DEAD" | grep -c "GUARD loading-state")"
# 300 + 5 × 200 + 50: the first page, five steps and the hold. The last waits
# for a load to end, and none began.
expect "gives every step its whole bound" "yes" \
  "$(at_least "$(when "$DEAD" "GUARD done")" 1350)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the history guard's module waits for what each step needs, and no longer"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
