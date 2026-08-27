import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { startCompositor } from "../start-compositor";

/** The module under test, as a child process has to name it. */
const MODULE = new URL("../start-compositor.ts", import.meta.url).pathname;

/**
 * A stand-in for the compositor: `script` runs with the same command line the
 * real one would get, and `$SESSION` already holds the path it is expected to
 * publish to.
 */
const standIn = async (script: string): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "domicile-stand-in-"));
  const program = path.join(directory, "compositor");
  await writeFile(
    program,
    `#!/bin/sh
set -e
while [ "$#" -gt 0 ]; do
  case "$1" in
    --session) SESSION="$2"; shift 2 ;;
    --chrome-socket) CHROME_SOCKET="$2"; shift 2 ;;
    --config) CONFIG="$2"; shift 2 ;;
    *) shift ;;
  esac
done
${script}
`,
    { mode: 0o755 },
  );
  return program;
};

const publishes = `
cat >"$SESSION.new" <<JSON
{ "protocol": 1, "chrome_socket": "$CHROME_SOCKET",
  "wayland_display": "wayland-stand-in",
  "chrome_wayland_display": "wayland-stand-in-chrome",
  "composited": false }
JSON
mv "$SESSION.new" "$SESSION"
# A short wait, so a stand-in that has been signalled does not hold the stderr
# pipe open — and the close event with it — for a whole second. The timing this
# file asserts is about the grace, and a second of unrelated residue next to a
# two-second grace leaves no room to tell the two apart.
while true; do sleep 0.05; done
`;

/** A compositor that ignores SIGTERM, as a wedged one does. */
const DEAF = `trap '' TERM
${publishes}`;

describe("startCompositor", () => {
  it("hands back the session the compositor published", async () => {
    const compositor = await startCompositor({
      present: false,
      program: await standIn(publishes),
    });
    try {
      expect(compositor.session.waylandDisplay).toBe("wayland-stand-in");
      // The socket the shell picked, which is what it will connect to.
      expect(compositor.session.chromeSocket).toMatch(/chrome\.sock$/);
    } finally {
      await compositor.stop();
    }
  });

  it("writes the config where the compositor was told to look", async () => {
    const compositor = await startCompositor({
      config: { nestedSize: [640, 480] },
      present: false,
      program: await standIn(
        `cp "$CONFIG" "$CHROME_SOCKET.config"\n${publishes}`,
      ),
    });
    try {
      const written = await Bun.file(
        `${compositor.session.chromeSocket}.config`,
      ).json();
      expect(written.compositor.nested_size).toEqual([640, 480]);
    } finally {
      await compositor.stop();
    }
  });

  it("says what the compositor said when it will not start", async () => {
    // The reason is always on stderr — a display it could not open, a config
    // it could not read — and a shell that only reported "it did not start"
    // would be throwing that away.
    const attempt = startCompositor({
      present: false,
      program: await standIn('echo "no display to open" >&2\nexit 3'),
    });
    await expect(attempt).rejects.toThrow("no display to open");
  });

  it("gives up on a stop that arrived before it began", async () => {
    // A signal already aborted when `startCompositor` is called — which is
    // what a Ctrl-C in the first milliseconds looks like by the time this gets
    // to it. Registering a listener on an already-aborted signal never fires,
    // so the stop was dropped and the desktop came up anyway.
    const stopping = new AbortController();
    stopping.abort();

    const attempt = startCompositor({
      present: false,
      program: await standIn(publishes),
      stopping: stopping.signal,
    });

    await expect(attempt).rejects.toThrow("stopped before it came up");
  }, 20_000);

  it("lets the process exit as soon as the compositor has gone", async () => {
    // Asserted on the *process*, not on `stop()`. `stop()` resolved promptly
    // even with the grace timer left armed — that was the shape of the bug —
    // and what actually held was the event loop, so a shell that had closed
    // its desktop sat there until the timer it no longer needed went off.
    //
    // Which means this has to be measured from outside: a child that starts a
    // compositor, stops it, and falls off the end.
    const directory = await mkdtemp(path.join(tmpdir(), "domicile-exit-"));
    const script = path.join(directory, "run.ts");
    await writeFile(
      script,
      `import { startCompositor } from ${JSON.stringify(MODULE)};
       const running = await startCompositor({
         present: false,
         program: ${JSON.stringify(await standIn(publishes))},
       });
       await running.stop();`,
    );

    const started = performance.now();
    const child = spawn(process.execPath, [script], { stdio: "ignore" });
    await once(child, "exit");

    // The grace is two seconds; a child that waited it out lands past 2000ms
    // however slow the runtime's own start was.
    expect(performance.now() - started).toBeLessThan(1500);
  }, 30_000);

  it("takes the run directory with it however the compositor went", async () => {
    // The socket lives in there. A directory left behind is a live socket left
    // behind, one per session, in $XDG_RUNTIME_DIR.
    const compositor = await startCompositor({
      present: false,
      program: await standIn(DEAF),
    });
    const directory = path.dirname(compositor.session.chromeSocket);

    await compositor.stop();

    expect(existsSync(directory)).toBe(false);
  }, 20_000);
});
