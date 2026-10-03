#!/usr/bin/env bash
# How the find guard's module paces itself, against a browser in miniature.
#
# Each step waits for the reading it needs, bounded by a timeout, so a healthy
# engine runs in seconds and a broken one falls back to the bounds — and gets
# every reading all the same, for the verdict to judge.
#
# Runs the real `guard-webview-find.js` under bun with a fake <webview>: a
# navigation starts loading, commits and finishes LATENCY ms apart, a find's
# count settles in two answers as the browser's does frame by frame, and a new
# page ends a find.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODULE="$ROOT/packages/domicile-engine/scripts/guard-webview-find.js"
[ -f "$MODULE" ] || {
  echo "no module at $MODULE" >&2
  exit 1
}
command -v bun >/dev/null 2>&1 || {
  echo "SKIP: no bun to run the find guard's module with"
  exit 77
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
HARNESS="$WORK/harness.js"
cat >"$HARNESS" <<'EOF'
// argv: module, query, behavior (healthy | dead), cap ms.
const [modulePath, query, behavior, capMs] = process.argv.slice(2);
const LATENCY = 20;
// The page's own count and its main frame's share of it.
const MATCHES = 3;
const MAIN_FRAME = 2;
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
const healthy = behavior === "healthy";
let findText = "";
const view = {
  addEventListener: (type, listener) => {
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  },
  find: (text, backward = false) => {
    if (healthy) {
      const next = text === findText;
      findText = text;
      const step = backward ? MATCHES - 1 : 1;
      const active = next
        ? ((view.findActiveMatch - 1 + step) % MATCHES) + 1
        : 1;
      // The main frame answers first and the cross-site frame after it.
      setTimeout(() => {
        report(next ? MATCHES : MAIN_FRAME, active);
        setTimeout(() => report(MATCHES, active), LATENCY);
      }, LATENCY);
    }
  },
  findActiveMatch: 0,
  findMatches: 0,
  loading: false,
  setAttribute: (name, value) => {
    const path = new URL(value).pathname;
    if (healthy) {
      setTimeout(() => {
        view.loading = true;
        setTimeout(() => {
          // Commit: the page is new, so the find is over.
          view.url = `http://fixture${path}`;
          findText = "";
          report(0, 0);
          setTimeout(() => {
            log(`GUARD guest-shown path=${path}`);
            view.loading = false;
          }, LATENCY);
        }, LATENCY);
      }, LATENCY);
    }
  },
  stopFinding: () => {
    if (healthy) {
      findText = "";
      setTimeout(() => report(0, 0), LATENCY);
    }
  },
  style: {},
  url: "",
};

// Sent only when it changes, as WebViewGuest::ReportFind does.
const report = (matches, active) => {
  if (matches !== view.findMatches || active !== view.findActiveMatch) {
    view.findMatches = matches;
    view.findActiveMatch = active;
    announce("domicile-find-change");
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
// The module does nothing on import; the document Domicile writes calls its
// `Shell`, and so does this.
(await import(modulePath)).Shell();
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

run() { # $1 behavior, $2 drive, $3 settle, $4 step, $5 quiet, $6 cap
  bun "$HARNESS" "$MODULE" \
    "drive=$2&src=http://fixture&word=quokkaish&matches=3&settle=$3&step=$4&quiet=$5" \
    "$1" "$6" 2>&1
}
# The ms at which the first line holding $2 was said, or nothing.
when() { # $1 output, $2 text
  printf '%s\n' "$1" | awk -v text="$2" 'index($0, text) { print $1; exit }'
}
has() { # $1 output, $2 text
  case "$1" in *"$2"*) echo yes ;; *) echo no ;; esac
}
at_least() { # $1 ms, $2 minimum
  if [ -n "$1" ] && [ "$1" -ge "$2" ]; then echo yes; else echo no; fi
}

# Bounds far above what a healthy step takes, and a cap below the first of
# them: a run that sat out any bound never finishes.
POSITIVE="$(run healthy find 3000 2000 200 2900)"
echo "the positive run, on a healthy engine"
expect "finishes without sitting out a bound" "no" "$(has "$POSITIVE" TIMEOUT)"
# Not the main frame's 2/1 that arrives first: the count has to settle.
expect "found is read once the count has settled" "yes" \
  "$(has "$POSITIVE" "find-state at=found find=3/1")"
expect "next is read once the second is selected" "yes" \
  "$(has "$POSITIVE" "find-state at=next find=3/2")"
expect "previous is read once the first is selected again" "yes" \
  "$(has "$POSITIVE" "find-state at=previous find=3/1")"
expect "stopped is read once the find is over" "yes" \
  "$(has "$POSITIVE" "find-state at=stopped find=0/0")"
expect "refound is read once the count is back" "yes" \
  "$(has "$POSITIVE" "find-state at=refound find=3/1")"
expect "navigated is read on the new page" "yes" \
  "$(has "$POSITIVE" "find-state at=navigated find=0/0")"
SHOWN="$(when "$POSITIVE" "guest-shown path=/elsewhere")"
NAVIGATED="$(when "$POSITIVE" "find-state at=navigated")"
expect "and only once that page has arrived" "yes" \
  "$(at_least "$((${NAVIGATED:-0} - ${SHOWN:-0}))" 0)"

CONTROL="$(run healthy none 3000 2000 200 2900)"
echo
echo "the control, on a healthy engine"
expect "finishes without sitting out a bound" "no" "$(has "$CONTROL" TIMEOUT)"
expect "calls no find" "no" "$(has "$CONTROL" "GUARD calling")"
# Nothing is driven, so there is nothing to wait for: the absence gets `quiet`.
NOT_FIND="$(when "$CONTROL" "GUARD not calling find")"
FOUND="$(when "$CONTROL" "find-state at=found")"
expect "an undriven step is watched for its quiet window" "yes" \
  "$(at_least "$((${FOUND:-0} - ${NOT_FIND:-0}))" 200)"
expect "every reading is 0/0 with no event" "6" \
  "$(printf '%s\n' "$CONTROL" | grep -c "find-state at=[a-z]* find=0/0 events=0")"

# Nothing ever arrives: every step sits out its bound, and every reading is
# still taken for the verdict to judge.
DEAD="$(run dead find 300 200 50 5000)"
echo
echo "an engine where nothing ever arrives"
expect "still finishes" "no" "$(has "$DEAD" TIMEOUT)"
expect "takes all six readings" "6" \
  "$(printf '%s\n' "$DEAD" | grep -c "GUARD find-state")"
# 300 + 5 × 200: the first page and five steps. The sixth, stopFinding(),
# waits for 0/0, which an element that never found anything already reads.
expect "gives every step its whole bound" "yes" \
  "$(at_least "$(when "$DEAD" "GUARD done")" 1300)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the find guard's module waits for what each step needs, and no longer"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
