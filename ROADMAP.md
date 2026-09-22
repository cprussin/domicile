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

1. **Keystroke to pixel, on a screen** (#206). `guard-latency.sh` reads 28–29 ms
   commit to pixel against a 16.67 ms display frame on every run so far — but in
   a nested compositor with nothing presenting, and with the probe's own round
   trip inside every figure. What is left is arranging the probe on a machine
   that lights a panel. [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md),
   *Keystroke to pixel*.

2. **A component that dies takes the windows with it.** `domicile-launch`'s
   `restart` stands a whole new desktop up when either component stops, so a
   crash is no longer a dead console. The windows are what is still lost: every
   app was a client of a Wayland display that went with the compositor, and
   nothing relaunches or reconnects one.

3. **No lock.** A desktop you walk away from is one anybody can walk up to.
   The *idle* half of this shipped: `idle.blank_after_seconds` in the config,
   `crate::idle` in the compositor for the decision and the edge, and the one
   thing that seam can already drive — the connectors go dark and come back on
   the next key, click, scroll or pointer movement
   ([how](docs/architecture/A-DESKTOP-ON-A-TTY.md#blanking-is-that-same-layout-with-the-light-taken-out-of-it)).
   A blank screen is still a screen: anybody can type at one. What is left is

   - **The lock itself**, which needs the shell, the host↔chrome protocol and a
     decision about where input stops — the seat holds the keyboard, so
     refusing to deliver it is this compositor's to do rather than the page's.
   - **Telling the shell.** Nothing but the connectors hears about idle today,
     so a shell cannot dim, warn, or show a lock screen a moment before the
     glass goes out. It is a message on the host↔chrome protocol and the
     `Idle` seam already names the moment.
   - **Idle inhibit.** The timer counts hands, not what is on screen, so a film
     playing with nobody at the trackpad blanks. Wayland's answer is
     `zwp_idle_inhibit_manager_v1` and Smithay ships support; what it needs
     here is a client's inhibitor reaching `Idle` and an answer for an
     inhibitor held by a client that died.

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
- **A desk left alone.** Run with `idle.blank_after_seconds = 60`, walk away for
  a minute, then touch the trackpad. Expect `nobody is at this desktop; its
  screens go dark connectors=N`, the panels off, and
  `somebody is at this desktop again; its screens come back on` with a
  `configuring N display(s)` behind it under `--vmodule=drm*=1`. Nothing here
  can see it: no runner has a `/dev/dri` at all, so every check this change
  brings is arithmetic over an injected instant. Plug a monitor in while it is
  dark for the second half — the new one must come up dark too.
- **The first real `./scripts/dev-shell.sh <name>`.** Its reload is asserted
  against a `domicile` the test writes — `scripts/test-dev-shell.sh` drives the
  watch loop, the coalescing and a refusal — so what is left is a real engine
  taking a rebuilt shell: a saved edit on the screen, the windows where they
  were, and a shell that would not load leaving the desk on the one it had.
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
- **A perspective over a window is reported, not corrected.** A projection is
  not an affine and no `Matrix` can hold one, so `defaultMeasure` composes the
  flattened 2D part — what CSS itself draws with no perspective in the chain —
  and says on the console that a pointer over that window is mapped as if the
  projection were not there. Correcting it wants a projective map through
  `surface-coordinates` rather than a 6-tuple. One shape is not even detected:
  a bare `perspective()` in an *ancestor's* transform list over a turn that
  `preserve-3d` carried up to it. `zoom` is fixed — the affine carries
  `currentCSSZoom`, the compounded factor the engine states — but only unit
  tests stand behind it, and unit tests here lay nothing out: no run in a
  browser has put a pointer on a zoomed window. A click guard on the engine, in
  the shape of `guard-webview-click.sh`, is what would carry that.
- **A guest refuses everything an embedder is asked for.** Permissions and
  dialogs route through `WebViewGuest`'s `WebContentsDelegate` and get the
  default answer. The window a page asks for is the one that has been answered:
  it is still refused, and the address now reaches the shell, which opens a
  browser window of its own — but `window.open` gets `null`, the opener and the
  target's name are not carried, and a form POSTed at a new target arrives as a
  GET of its action.
- **A browser window's padlock rests on a guard that cannot fail it.**
  `PageChanged` carries the guest's visible entry — the address, and
  `security_state::GetSecurityLevel` over that same entry, which is where
  Chrome's own omnibox lock comes from. What is not measured is which verdict:
  the fixture serves plain http from localhost, so the guard asserts that one
  arrives and that the address follows a `goBack()` the shell never made, and
  nothing more. The cases a scheme test gets wrong — an expired certificate, a
  name that does not match, active mixed content — need an https fixture with a
  cert the browser distrusts, and until one exists `dangerous` is a path no run
  has taken.
- **A client that draws its own cursor into a surface gets a plain arrow.**
- **A `wl_output` that is not a panel reports no physical size and no refresh** —
  zero for both, which is what `wl_output` says a screen with no such number
  advertises. On a tty they are the panel's own, off the `DisplaySnapshot` the
  CRTCs are configured from.
- **Hot-swapping the chrome page is a page reload**, survivable only because
  `announce_open_apps` re-states the desktop to a page that has just loaded.
  `domicile load-shell` is what asks for one, so a shell that keeps state in
  its page loses it on every swap; the windows do not go, because the
  compositor never hears about any of this.

---

Working in this repository: [AGENTS.md](AGENTS.md) is the rules,
[docs/DEVELOPING.md](docs/DEVELOPING.md) is running, testing and debugging it.
