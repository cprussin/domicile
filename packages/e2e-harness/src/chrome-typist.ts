// biome-ignore-all lint/suspicious/noConsole: what it reports is its output

// Type into the desktop the way a person does: real input events, delivered to
// the chrome's own window, which forwards them to the focused client.
//
// `keystroke-driver.ts` types over the *host socket* instead, which is what
// makes `measure.sh`'s two paths comparable — the chrome's clock is out of the
// loop on both. The cost of that is `rt_ms` and `ipc_ms`, the two numbers a
// person actually feels, which nothing then measures at all. This is the other
// half: it goes through the page, so the bridge sees the keystroke leave and
// the frame arrive, and both numbers exist.
//
// Chromium's own input pipeline via CDP, not a synthesised `KeyboardEvent`.
// `dispatchEvent` on an untrusted event would still reach the SDK's listener,
// but it would skip everything Chromium does between a key arriving and the
// page hearing about it — which is inside what `rt_ms` claims to measure.

import { z } from "zod";

/** evdev `a`, and the DOM code the SDK maps it from. A printable character. */
const KEY_A = { code: "KeyA", key: "a", windowsVirtualKeyCode: 65 };

/**
 * Long enough that each keystroke is its own round trip on any sane client.
 *
 * The page measures a key only while no other key of its own is outstanding,
 * so typing faster than a client can redraw does not corrupt the number — it
 * shrinks the sample, and `keys=answered/sent` is what says so. This paces
 * well clear of that: a round trip that took this long would be the finding.
 */
const BETWEEN_KEYS_MS = 250;

/**
 * How long to wait after the last keystroke before reading the result.
 *
 * Longer than the chrome's own reporting interval, because it reports on a
 * timer and the run is over when this returns. Waiting less than the interval
 * threw away every keystroke since the last tick — measured, 40 sent and 34
 * reported, with nothing in the output to say the other six existed.
 */
const SETTLE_MS = 7000;

type Cdp = {
  send: (method: string, params?: Record<string, unknown>) => void;
  close: () => void;
};

/**
 * What the debugger says it has open.
 *
 * Parsed rather than asserted: this port is whatever answered on it, and the
 * failure worth naming is a *different* program replying with well-formed JSON
 * of another shape. An `as` cast turns that into `undefined is not an object`
 * three lines later.
 */
const targets = z.array(
  z.object({ type: z.string(), webSocketDebuggerUrl: z.string() }),
);

/** How long the debugger has to answer before the run gives up on it. */
const ATTACH_MS = 10_000;

/** The debugger's websocket for the first page target it offers. */
const attach = async (port: number): Promise<Cdp> => {
  const answered = await fetch(`http://127.0.0.1:${port.toString()}/json`);
  const offered = targets.safeParse(await answered.json());
  if (!offered.success) {
    throw new Error(
      `chrome-typist: port ${port.toString()} answered, but not as a debugger`,
    );
  }
  const page = offered.data.find((target) => target.type === "page");
  if (page === undefined) {
    throw new Error("chrome-typist: the debugger offered no page to type into");
  }
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  // A deadline and an error listener, because the bare `open` promise never
  // settles if the target is stale — and the script waits on this process with
  // no timeout of its own, so the whole run hangs with nothing said.
  await new Promise<void>((ready, fail) => {
    const giveUp = setTimeout(() => {
      fail(new Error("chrome-typist: the debugger never opened its socket"));
    }, ATTACH_MS);
    socket.addEventListener("error", () => {
      clearTimeout(giveUp);
      fail(new Error("chrome-typist: the debugger's socket would not open"));
    });
    socket.addEventListener("open", () => {
      clearTimeout(giveUp);
      ready();
    });
  });
  let id = 0;
  return {
    close: () => {
      socket.close();
    },
    send: (method, params = {}) => {
      id += 1;
      socket.send(JSON.stringify({ id, method, params }));
    },
  };
};

const rest = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));

/**
 * Click the window before typing at it.
 *
 * The SDK routes keys to whichever `<domicile-app>` was last pointed at —
 * keyboard events land on the document, not on an element — so a run that
 * skipped this would type into a desktop with no focused window and measure
 * nothing, silently. Clicking is also what a person does.
 */
const clickTheWindow = (cdp: Cdp, at: { x: number; y: number }): void => {
  for (const type of ["mousePressed", "mouseReleased"]) {
    cdp.send("Input.dispatchMouseEvent", {
      button: "left",
      clickCount: 1,
      type,
      x: at.x,
      y: at.y,
    });
  }
};

const type = async (cdp: Cdp, keystrokes: number): Promise<void> => {
  for (let sent = 0; sent < keystrokes; sent += 1) {
    cdp.send("Input.dispatchKeyEvent", { ...KEY_A, type: "keyDown" });
    cdp.send("Input.dispatchKeyEvent", { ...KEY_A, type: "keyUp" });
    await rest(BETWEEN_KEYS_MS);
  }
};

/** What was typed, so the script can hold the report to it. */
const report = (keystrokes: number): void => {
  console.log(`typist: sent=${keystrokes.toString()}`);
};

/**
 * The middle of the desktop, which is where the window is.
 *
 * The compositor gives its only window the whole output, and the harness runs
 * a 1280x800 screen — so the centre of that is inside the window whatever the
 * window happens to be. Fixed rather than configurable: the one caller has no
 * reason to want anywhere else, and a knob nobody turns is a knob to keep
 * working.
 */
const MIDDLE = { x: 640, y: 400 };

/** `chrome-typist.ts <debugger port> <keystrokes>`. */
const port = Number(Bun.argv[2]);
const keystrokes = Number(Bun.argv[3] ?? "40");
if (!Number.isInteger(port) || port < 1) {
  throw new TypeError(
    `chrome-typist: ${String(Bun.argv[2])} is not a debugger port`,
  );
}
if (!Number.isInteger(keystrokes) || keystrokes < 1) {
  throw new TypeError(`chrome-typist: ${String(Bun.argv[3])} is not a count`);
}

const cdp = await attach(port);
clickTheWindow(cdp, MIDDLE);
await rest(250);
await type(cdp, keystrokes);
report(keystrokes);
// The last keystroke's frame is still in flight, and the chrome reports on an
// interval rather than per key — so this has to outlast the interval or the
// run ends before the numbers it produced are printed.
await rest(SETTLE_MS);
cdp.close();

export {};
