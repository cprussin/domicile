#!/usr/bin/env bash
# Tests that guard-webview-crash.js reloads its view only once the page is
# heard gone, not on a timer from the crash.
#
# A crashing renderer prints its symbolized stack before it dies, which took
# 15s on crux (CI run 38830528244). A reload sent while it still lived went to
# the dying process and was lost with it, so the page never came back.
#
# Runs the guard's own `HostShell` under bun, with a fake page and clock.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SHELL_JS="$ROOT/packages/domicile-engine/scripts/guard-webview-crash.js"
[ -f "$SHELL_JS" ] || {
  echo "no guard shell at $SHELL_JS" >&2
  exit 1
}
command -v bun >/dev/null || {
  echo "SKIP: no bun, which runs the guard's shell"
  exit 77
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "$SHELL_JS" "$WORK/shell.mjs"
cat >"$WORK/run.mjs" <<'JS'
import { HostShell } from "./shell.mjs";

const SETTLE = 4000;
const SRC = "http://127.0.0.1:1/page";

// One fake page per run: a clock run by hand, a view that records reloads.
const run = (crash) => {
  let now = 0;
  const timers = [];
  globalThis.setTimeout = (callback, delay) => {
    timers.push({ at: now + delay, callback });
  };
  const advance = (ms) => {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      if (timers.length === 0 || timers[0].at > until) break;
      const timer = timers.shift();
      now = timer.at;
      timer.callback();
    }
    now = until;
  };

  const view = new EventTarget();
  Object.assign(view, {
    style: {},
    url: "",
    loading: false,
    renderProcessGone: "",
    renderProcessExitCode: 0,
    reloads: 0,
    reload() {
      this.reloads += 1;
    },
  });
  globalThis.document = {
    body: { style: {}, append() {} },
    createElement: () => view,
  };
  globalThis.location = {
    search: `?crash=${crash ? 1 : 0}&settle=${SETTLE}&src=${SRC}`,
  };
  globalThis.console = { log() {} };

  HostShell(null, new EventTarget());
  view.url = SRC;
  view.dispatchEvent(new Event("domicile-loading-change"));
  return { view, advance };
};

const failures = [];
const expect = (what, want, got) => {
  if (want === got) {
    process.stdout.write(`  ok    ${what}\n`);
  } else {
    process.stdout.write(`  FAIL  ${what}: wanted ${want}, got ${got}\n`);
    failures.push(what);
  }
};

{
  const { view, advance } = run(true);
  advance(SETTLE);
  expect("the claim crashes the view", "chrome://crash", view.src);
  advance(60_000);
  expect("a page still dying is not reloaded", 0, view.reloads);
  view.renderProcessGone = "crashed";
  view.renderProcessExitCode = 139;
  view.dispatchEvent(new Event("domicile-render-process-change"));
  advance(SETTLE);
  expect("a page just heard gone is left for its pixel", 0, view.reloads);
  advance(SETTLE);
  expect("a page heard gone is reloaded once", 1, view.reloads);
}

{
  const { view, advance } = run(false);
  advance(SETTLE);
  expect("the control leaves the view alone", SRC, view.src);
  advance(2 * SETTLE);
  expect("the control reloads after its step", 1, view.reloads);
}

process.exit(failures.length === 0 ? 0 : 1);
JS

if bun "$WORK/run.mjs"; then
  echo "the crash guard reloads a dead page only once it is heard gone"
  exit 0
fi
echo "guard-webview-crash.js reloads on the wrong cue" >&2
exit 1
