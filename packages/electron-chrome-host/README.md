# @domicile/electron-chrome-host

> Published to npm, and usable outside this repo — see
> [/docs/WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md). It ships built
> JavaScript and `.d.ts` from `dist/`, and takes `electron` as a peer
> dependency: the shell embedding it brings its own.

The process-side half of a Domicile shell.
[`@domicile/chrome-sdk`](../chrome-sdk/README.md) is what the *page* talks to
the compositor with; this is everything around that page — starting the
compositor the shell runs on, opening the window, and dying with a reason — and
it is the same for every shell in the tree.

A shell is the program a user runs, and the compositor is what it starts
underneath itself. `./launch-shell` is that inversion in one call.

Electron is scaffolding. The eventual target embeds CEF directly, at which point
the engine integration answers all of this and this package goes away — which is
why it is one package rather than a thing each shell reimplements: when it is
deleted there is one place to delete it from. Until then, every fix to a socket
that dies in an unusual way lands once.

## What it holds

| Module | What |
|---|---|
| `./chrome-window` | `openChromeWindow` and `loadChromePage` — the window a chrome is drawn in, what it must and must not paint, and getting its page into it. |
| `./launch-shell` | `launchShell` — the whole of a shell's entry point: start the compositor, then start the chrome inside it. |
| `./start-compositor` | `startCompositor` — the compositor alone, for a shell that arranges its own chrome process. |
| `./compositor-config` | `CompositorConfig`: what a shell can tell the compositor about the desktop, and how it is written down. |
| `./desktop-config` | `parseDesktop` — that section read out of a shell's *own* config file, with the compositor's rules applied where the user can still see the file they wrote. |
| `./compositor-session` | The session a running compositor publishes: the sockets, the displays, and whether it is compositing. |
| `./session-from-environment` | `sessionFromEnvironment` — the same, as the chrome's own process receives it. |
| `./compositor-command` | The compositor's command line. The writing half of what `domicile-launch` parses. |
| `./chrome-invocation` | The environment and arguments the chrome's Electron process is started with. |
| `./await-session` | Waiting for a compositor to come up, or saying why it did not. |
| `./socket-path` | `socketPathFrom` — the chrome socket read back off the renderer's command line. |
| `./compositor-socket` | `connectToCompositor` — the socket's whole life, and everything that can go wrong with it. |
| `./chrome-failure` | `CHROME_FAILURE_CHANNEL` and both its ends: `reportOnce`, `orDie` and `orDieStarting` for the page and the start, `stopOnChromeFailure` for the host — and `failHere`, for the host's own failures. |

The host protocol is deliberately *not* here. The preload holds the compositor
socket itself and hands the page its messages over `postMessage`, so a frame's
pixels never cross a process boundary; see
[`@domicile/chrome-sdk/host-transport`](../chrome-sdk/README.md) for that half.
Channels a single chrome needs — the diagnostics manganese prints, the shortcuts
a `<webview>` would otherwise swallow — belong to that chrome, not to this
package. Dying with a reason is the one thing every chrome does, so it is the
one channel here.

## Usage

A shell's launcher is the whole of its entry point:

```ts
// src/launch.ts — run by the `bin/` stub, under Electron's Node
process.exitCode = await launchShell({
  config: myDesktop,                     // what to tell the compositor
  main: path.join(dirname, "main.js"),   // the Electron bundle
  present: true,
});
```

Its Electron process then reads the session the launcher passed down, opens the
window, and passes the socket on the renderer's command line — the preload has
to connect before the page's first message. The window comes back with nothing
in it, so a chrome can arrange whatever it needs of it before its page is there:

```ts
const session = sessionFromEnvironment(process.env);

const sayAndStop = {
  exit: (code: number) => { app.exit(code); },
  write: (line: string) => { process.stderr.write(line); },
};
const fail = failHere(sayAndStop);

const win = openChromeWindow(
  {
    composited: session.composited,
    preload: path.join(dirname, "preload.cjs"),
    socketPath: session.chromeSocket,
    webviewTag: true,
  },
  (options) => new BrowserWindow(options),
  fail,
);
takeGuestShortcuts(win.webContents, ipcMain);   // this chrome's own
loadChromePage(win, page, fail);

stopOnChromeFailure({ ...sayAndStop, ipc: ipcMain });

// …and the whole start, whose rejection is the one a main process can least
// afford to throw from:
orDieStarting(fail, app.whenReady().then(() => { /* the above */ }));
```

`open` is a parameter rather than `new BrowserWindow` reached for directly:
nothing here imports Electron, which is what lets every module load — and be
tested — outside it.

`fail` is one too, and for a second reason: **a throw would not report this
window's failures.** Electron pins Node's legacy `--unhandled-rejections=warn`,
so a throw inside a `.catch` in the main process prints an
`UnhandledPromiseRejectionWarning` to a stderr nobody is reading and then goes
on to exit 0 — leaving a desktop whose windows are all covered, or a blank
window with no page in it, and saying so nowhere. (A *synchronous* throw is no
better: Electron's default handler puts up a message box and waits.) Only an
explicit `app.exit` gets the failure out, which is what `failHere` reaches.

The preload reads that path back off its own `argv`, and connects or says why it
could not:

```ts
const fail = reportOnce((line, code) => {
  ipcRenderer.send(CHROME_FAILURE_CHANNEL, line, code);
});

orDie(fail, () => {
  const stream = connectToCompositor({
    fail,
    onPageHide: (listener) => { window.addEventListener("pagehide", listener); },
    path: socketPathFrom(process.argv),
  });
  contextBridge.exposeInMainWorld("domicileHost", postHostMessages(stream, post));
});
```

`fail` is injected because saying why and stopping is one action a renderer can
do neither half of: it sends the line and the code down `CHROME_FAILURE_CHANNEL`,
and the main process writes stderr and exits.

## What `openChromeWindow` knows that a `BrowserWindow` does not

`composited` — whether Domicile is drawing this window's clients itself — decides
everything the window paints, and it is not a preference:

- The window is **transparent and unframed**, because the `<domicile-app>`
  elements are holes the clients show through. A background, or a title bar, is
  then between the user and the window they are looking at. The desktop has no
  furniture of its own anyway, and the compositor gives it the whole output
  whatever size is asked for.
- The **page's** background goes too, injected on `did-finish-load` rather than
  authored into a shell's stylesheet: a design system paints `html`, and that
  would cover the holes just as well. It is a property of how the window is
  presented, not of the chrome — the same page down the copy path wants it.

Neither is true in the copy path, where the clients' pixels are drawn into a
canvas and the window is an ordinary one.

## What `connectToCompositor` knows that a socket does not

Each of these was a bug found once, and is why the connection is a module rather
than five lines in a preload:

- A peer that dies on a Unix stream socket sends a **FIN**, which Node reports as
  `end` then `close` and never as an `error`. Without that handler the desktop
  goes on drawing a still of a machine that is gone.
- Node emits `close` after **every** `error`, so an unguarded `close` handler
  reports a second time and gets it wrong — a socket that was never there reads
  as a compositor that hung up.
- A **reload** tears the preload's Node environment down with the document, and
  the socket closing on the way is not a compositor that died. Read as one, it
  prints a failure and exits non-zero on every reload and every ordinary quit.
- An unhandled `'error'` is an **uncaught exception** in Node, so a shell started
  without a compositor — the ordinary way to get this wrong — dies on a
  `PipeConnectWrap` stack rather than a sentence about the socket.

`connectToCompositor` takes the socket opener as an injected parameter
defaulting to `net.connect`, so all four are unit-tested without Electron and
without a compositor.

## Dependencies

One: `zod`, for the two modules that parse something written elsewhere — the
session a compositor published (`./compositor-session`) and the desktop out of
a shell's own config file (`./desktop-config`). Everything else is the
runtime's: `node:net`, `node:path`, `node:child_process`. Electron is imported
for its types only — `BrowserWindow` arrives as a parameter, so every module
here loads (and tests) outside Electron.

## Test

```sh
bun run --filter @domicile/electron-chrome-host test
```
