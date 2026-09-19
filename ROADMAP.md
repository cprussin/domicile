# Domicile roadmap

The open work and who can do it. What Domicile is and how it is built are
[README.md](README.md) and
[ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md); each item below links to
the design doc that carries its detail.

Nothing is released. The wire protocol is at `PROTOCOL_VERSION = 1`, and
`packages/domicile-engine/engine-release.nix` pins the engine a user gets.

## Where it stands

A desktop runs — on a bare tty or nested in a Wayland session, on the forked
Chromium the flake pins. A client's window is an `<app>` element in the shell's
page, composited at native cost, and seven CSS properties are bit-exact against
an ordinary element beside it. `<webview>` is a browser window the shell lays
out, with history, loading and new-window reported to the page. Keys, the
trackpad and a click reach the page on real hardware.

The evidence for each of those is in the doc that made the claim —
[ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md),
[A-DESKTOP-ON-A-TTY.md](docs/architecture/A-DESKTOP-ON-A-TTY.md) — and in the
`packages/domicile-engine/scripts/guard-*.sh` that assert it.

## In this repository

1. **Delete the SDK's placement reporting** — `observe-placement.ts`,
   `placement-timing.ts`, `report-app-sizes.ts` and `resizeApp`. An `<app>`'s
   layout box *is* the `xdg_toplevel.configure`: the fork reports it natively
   and `ExternalSurfaceProvider::Embed` already carries the size, so the
   chrome's half is redundant. `measure.ts`, `element-transform.ts` and
   `matrix.ts` stay — `pointer-input.ts` inverts that affine so a click lands
   correctly on a window under a CSS rotation.

   Unblocked, and it closes the two-configures gap below. Run `guard-shell.sh`
   against the deletion deliberately: `engine.yml` filters on
   `packages/domicile-engine/**`, so nothing in CI drives the native tag on a
   change that is entirely inside the SDK.

2. **`domicile load-shell <path>`** — the supervisor's half. The engine answers
   `load_shell` on `--domicile-command-socket` and every pinned release carries
   it; what is left is that switch on the engine's command line in `spawn`, the
   verb in `cli` and `control`, and `answer` dialing the engine instead of
   holding the answer itself.
   [THE-DOMICILE-BINARY.md](docs/architecture/THE-DOMICILE-BINARY.md). Dev
   reload comes back with it — until then `scripts/dev-shell.sh` restarts the
   desktop on every rebuild.

3. **Keystroke to pixel, on a screen** (#206). `guard-latency.sh` reads 28–29 ms
   commit to pixel against a 16.67 ms display frame on every run so far — but in
   a nested compositor with nothing presenting, and with the probe's own round
   trip inside every figure. What is left is arranging the probe on a machine
   that lights a panel. [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md),
   *Keystroke to pixel*.

4. **A component that dies takes the windows with it.** `domicile-launch`'s
   `restart` stands a whole new desktop up when either component stops, so a
   crash is no longer a dead console. The windows are what is still lost: every
   app was a client of a Wayland display that went with the compositor, and
   nothing relaunches or reconnects one.

5. **No idle, no lock, no DPMS.** A desktop you walk away from is one anybody
   can walk up to, and blanking a screen after a timeout is the same seam. Not
   started.

## In the engine fork — the agent on `crux`

1. **An shm→dmabuf upload.** `publish_frame` submits only
   `CommittedBuffer::Gpu`, so a client that draws into shared memory has no
   window and the compositor says so once per client. Deferred deliberately, so
   there is one path to write the upload against rather than an interim tree.
   [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md), phase 2.

2. **Presentation, measured.** Every number in the fork's docs comes from a
   `CopyOutputRequest`; nothing reads a lit CRTC, so overlay promotion, damage
   and the presentation half of latency are all unmeasured.
   [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md), phase 3.

3. **Two things left on the tty.** Take `/dev/dri/card0` from logind —
   `TakeDevice` plus `PauseDevice`/`ResumeDevice` — which supersedes the
   browser's own `open()` and closes the gap where a console switch outruns the
   master drop by a D-Bus round trip; and stop the evdev thread blocking for the
   length of a switch. [A-DESKTOP-ON-A-TTY.md](docs/architecture/A-DESKTOP-ON-A-TTY.md),
   step 2.

4. **Measure a `backdrop-filter` over an `<app>`.** Expected to work: viz applies
   a backdrop filter on the render pass aggregation has already inlined the
   window's quads into, and declines overlay promotion under one. Nobody has run
   it, and it belongs in `guard-css-and-resize.sh` beside the seven properties
   already there.
   [WINDOW-COMPOSITING.md](docs/architecture/WINDOW-COMPOSITING.md).

5. **Strip what a desktop never runs.** The tab strip, the New Tab page,
   settings, sign-in and sync are built, shipped in the release tarball and in
   the attack surface, and a desktop can reach none of them. Measure per
   subsystem before patching — nobody knows whether it saves 5% or 40%. PDFium
   stays: a desktop should render a PDF in a window. The viewer UI is a separate
   question.

## Needs a machine with a screen

No agent and no CI runner here can see one — `crux` has a card but no panel it
can render to, so a person with a laptop is the whole of this channel. Each of
these is one run, and each has a line to look for.

- **Suspend and resume.** Close the lid, open it. Under `--vmodule=drm*=1`, no
  `the machine is awake` line means `PrepareForSleep` never arrived and
  `DrmSleep` is not subscribed; that line without a `configuring N display(s)`
  after it means the relight ran and the modeset did not.
- **A console switch.** `Ctrl+Alt+F<n>` away and back — same
  `configuring N display(s)` line. Before `DrmModeset::Relight` this froze and
  killed the GPU process fifteen seconds later.
- **A dead component.** `pkill domicile-compositor`: expect a new desktop within
  a second and `starting the desktop again in 1s — that is failure 1 of 5 in a
  row.` The windows will not come back, which is the item above rather than a
  fault in the restart.
- **The first real `./scripts/dev-shell.sh <name>`.**
- **Which way round the two quarter turns are** — see the gaps below.
- Anything about orientation or presentation, and re-measuring latency or CSS
  parity after a change that could move either.

## Known gaps

True, understood, and not scheduled. Each is here so that finding it again
costs nothing.

- **A `wl_shm` client's window is blank** — the upload above.
- **A frame in which the chrome repainted reports the whole output damaged.**
  The chrome is one layer covering the desktop, and it repaints for a clock, a
  caret, a hover.
- **A mixed-density desktop is drawn at one density, and `wl_output.scale` rounds
  up.** Deliberate: a client rendering at 2× downscaled is sharper than one at 1×
  stretched. Only the integer a client is handed rounds — a profile's own scale
  is fractional and rides `xdg_output`.
- **A monitor profile states no mode.** It turns a connector on and off, places
  it, scales and turns it; the mode arrives with the monitor, so a profile's
  positions are sums of sizes it does not control.
- **Only a desk can say which way the quarter turns go.** `rotate-90` names the
  turn the *content* takes, which is `wl_output`'s convention, and every list
  from `domicile-config` to `turn()` in `cover-the-window.ts` applies it as
  written — so the reading agrees with itself all the way down. Swapping two arms
  of one `switch` is the whole fix if it is wrong.
- **A client that pre-rotates its own buffer is still wrong.** `wl_output.transform`
  invites it and nothing reads `wl_surface.set_buffer_transform`; the fix is in
  the dmabuf submit path.
- **A monitor's name is the three-letter PNP id, not the vendor** — `DEL DELL
  U3219Q 2ZLS413` rather than `Dell Inc. DELL U3219Q 2ZLS413`. The table behind
  the id is hwdata's `pnp.ids`, which libdisplay-info carries and Chromium does
  not. A profile may name the output `drm-<id>` instead.
- **A 3D transform or a `zoom` above a window is invisible to the SDK.**
  `defaultMeasure` reads each ancestor's computed style, but a perspective does
  not reach the child's matrix and `zoom` scales the box without being a
  transform — so the compositor is told two wrong things about one window.
- **A guest refuses everything an embedder is asked for.** Permissions and
  dialogs route through `WebViewGuest`'s `WebContentsDelegate` and get the
  default answer. The window a page asks for is the one that has been answered:
  it is still refused, and the address now reaches the shell, which opens a
  browser window of its own — but `window.open` gets `null`, the opener and the
  target's name are not carried, and a form POSTed at a new target arrives as a
  GET of its action.
- **A browser window's address bar cannot follow its page.** The element reports
  `canGoBack`, `canGoForward` and `loading` and nothing that names a URL, so a
  chrome can show where it *sent* a window and that something is arriving, and
  not where the page then went.
- **Two things configure a client, and they disagree by a border.** The engine
  states an `<app>`'s box from `ReplacedContentRect` — the content box — and
  `resize_app` reports `offsetWidth`/`offsetHeight`, the border box, so a
  floating window gets two configures a layout change. Closes with the deletion
  above.
- **A config reload acts on the display list and nothing else.** `output.max_scale`,
  the keymap and the rest are stored and keep their startup values.
- **A client that draws its own cursor into a surface gets a plain arrow.**
- **A `wl_output` that is not a panel reports no physical size and no refresh** —
  zero for both, which is what `wl_output` says a screen with no such number
  advertises. On a tty they are the panel's own, off the `DisplaySnapshot` the
  CRTCs are configured from.
- **Hot-swapping the chrome page is a page reload**, survivable only because
  `announce_open_apps` re-states the desktop to a page that has just loaded.
  Nothing a user runs asks for one; `scripts/dev-shell.sh` does, on every
  rebuild.

---

Working in this repository: [AGENTS.md](AGENTS.md) is the rules,
[docs/DEVELOPING.md](docs/DEVELOPING.md) is running, testing and debugging it.
