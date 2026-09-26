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
   trip inside every figure.

   **The probe is arranged now**: `PLATFORM=drm` takes the same run on the
   scanout platform, with the window the CRTC's rectangle rather than a size,
   and the guard refuses each platform in the other's place rather than dying
   somewhere else about a socket. What is left is somebody running it on a
   machine that lights a panel — see *Needs a machine with a screen* below.
   Presentation is still not what it measures, on a panel or off one: the probe
   is a `CopyOutputRequest` that forces the draw it reads.
   [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md), *Keystroke to pixel*.

2. **A compositor that dies still takes the windows with it.** The engine half
   shipped: an engine that stops is replaced under the compositor that did not,
   which re-dials the broker socket the new one bound and states this desktop
   to it again — a frame sink per window, every client buffer imported again,
   and the frame each window had on screen put straight back up, so the clients
   keep the `wl_display` they are connected to and never hear about any of it
   ([how](docs/architecture/THE-DOMICILE-BINARY.md)). What is left is the other
   direction and one gap the first one leaves:

   - **A compositor that dies is still a whole new desktop**, and the apps go
     with it. The page dials the compositor's control socket and that channel
     deletes itself when either end goes away, with only a bounded reach at
     startup (`kReachFor`) — so nothing on this side can reopen it. Making a
     page re-reach a compositor that replaced the one it had is a C++ change in
     `control_channel.cc`, which is the fork.
   - **Nothing in the C ABI says the engine went away.** `domicile_engine.h`
     carries four callbacks and none of them is a disconnect, so the compositor
     recognizes a new engine by the process serving the page that says hello —
     `SO_PEERCRED`, the kernel's word, in
     `packages/domicile-compositor/src/which_engine.rs`. It works and it is a
     proxy. A `disconnected` callback would make it the engine's own statement
     and would also cover an engine that dies with no page to replace it.
   - **The rejoin itself has never met a real engine.** Every decision in it is
     unit-tested — which buffers come back and which go straight up again, and
     which process counts as another engine — but the `dlopen`, the second
     `domicile_engine_connect` and the re-import need a built
     `libdomicile_engine.so` and a GPU. See the `pkill` below.
   - **On a tty there is no screen between two engines**, because the engine is
     what holds DRM master. Deliberate rather than overlooked: the new engine
     modesets from the same `DisplaySnapshot`s and the compositor states its
     connectors to it again, so the desk comes back — it just goes dark for the
     second or two it takes.

3. **The lock has a verifier, and what is left is around it.** A desktop you
   walk away from locks itself, and what opens it is the password of the user
   it runs as. The *idle* half shipped first:
   `idle.blank_after_seconds` in the config, `crate::idle` in the compositor for
   the decision and the edge, the connectors going dark and coming back on the
   next key, click, scroll or pointer movement — with a client playing a film
   holding them on through all of it, for exactly as long as it is running and
   the window it is playing in is on the desktop: an inhibitor whose client died
   holds nothing, and neither does one taken on a surface nobody can see
   ([how](docs/architecture/A-DESKTOP-ON-A-TTY.md#blanking-is-that-same-layout-with-the-light-taken-out-of-it))
   — and an `idle` message on the host↔chrome protocol that tells the shell
   which of the two a desk is in ([what a shell does with
   it](docs/WRITING-A-SHELL.md#when-nobody-is-at-the-desk)).

   **And then the lock's mechanism**: a desk that states what opens it under
   `[lock]` locks itself on that same dark edge, `crate::lock` holds whether it
   is locked, and while it is, every key, click, scroll and pointer movement the
   shell forwards is dropped before it reaches the seat — so no Wayland client
   on the desk is given one
   ([where and why](docs/architecture/A-DESKTOP-ON-A-TTY.md#and-it-locks-the-desk-which-is-a-refusal-at-the-injection)).
   The compositor holds that state, so a page reload does not open the desk and
   neither does an engine that died and came back; a `locked` message carries it
   to every chrome and again to one that has just said hello, and `unlock`
   carries a passphrase back ([what a shell does with
   it](docs/WRITING-A-SHELL.md#a-locked-desk)). The page keeps its own keys
   throughout, which is what lets it draw a lock screen at all, and the seat lets
   go of whatever it was holding on the turn the desk shuts — a release is the
   one thing a refusal cannot drop. The same refusal covers what a shell asks
   done to the desktop: a locked desk closes no window, starts no program and
   puts no clipboard row back, and a launcher's `search_files` and
   `preview_file` are answered with nothing, whatever panel the shell left up to
   ask with — and it says so in its log. The list is a `match` with no
   wildcard, over what the Wayland thread is asked and what a chrome connection
   answers itself, so a request added to either does not compile until somebody
   decides whether a locked desk answers it.

   **And now the verifier**: a desk that states `lock.pam_service` is opened by
   `pam_authenticate` against the user the compositor runs as — the uid, never
   `$USER` — through that PAM service, which is what every other lock screen on
   Linux does and what takes the secret out of the world-readable file
   (`crate::pam`, behind the same `crate::lock::Verifier` seam). The check runs
   on a thread of its own and the verdict comes back through the loop, because
   PAM sleeps on a wrong password and the thread a passphrase arrives on is the
   one every client's frame waits for; the desk stays shut while it runs. A desk
   states `pam_service` or `passphrase` and never both, and neither is a
   fallback for the other: a service `/etc/pam.d` does not have is a desk that
   does not come up and says what to declare, and a stack that cannot run is an
   error in the log rather than a wrong passphrase
   ([how](docs/architecture/A-DESKTOP-ON-A-TTY.md#and-it-locks-the-desk-which-is-a-refusal-at-the-injection)).
   It needed no engine release and no protocol change. `lock.passphrase` stays,
   still readable by anybody who can read the disk and still not compared in
   constant time, for a machine with no service to name.

   What is left is

   - **The PAM service is a line the machine carries.** A home-manager module
     cannot declare one, and there is no NixOS module here to do it, so a desk
     that names `lock.pam_service = "domicile"` needs
     `security.pam.services.domicile = {};` in its system configuration too —
     [RUNNING-A-DESKTOP.md](docs/RUNNING-A-DESKTOP.md#the-screen-going-dark)
     says so, and the compositor says so when it is missing. A NixOS module
     would make that one line rather than two in two places.
   - **Nothing locks a desk on purpose.** The idle edge is the only thing that
     locks one, so there is no "lock now" — no chord, no menu item, no
     `ChromeMessage` for it — and a desk with no `idle.blank_after_seconds` never
     locks however loudly it states a passphrase. A shell wants to be able to
     ask, which is one message and a `Lock` on `ClientRequest`.
   - **A wrong passphrase is answered with silence.** No verdict crosses the
     protocol, so a shell cannot say "that was wrong", cannot count tries and
     cannot rate-limit them; the compositor logs the refusal and the desk stays
     shut. The field clearing is the only feedback there is, and with PAM behind
     the seam the refusal also takes as long as PAM's delay on a failure, which
     the shell cannot see either. What this wants is a message carrying the
     verdict — and a "checking" state, since keys sent while one is being
     checked reach nothing.
   - **A reload does not move the lock.** `[lock]` is read at startup and
     nowhere else, deliberately: rebuilding the verifier under a locked desk
     would be either an unlock by file edit or a locked desk with nothing left
     to open it. So a verifier added, changed or removed is the verifier of the
     next run, which is the safe answer rather than the right one.
   - **A moment before, rather than at the moment.** The shell is told now,
     but `HostMessage::Idle` goes out on the turn the screens are told to go
     dark — ahead of the modeset, not ahead of the timeout — so there is
     nothing to dim through, count down with or raise a lock during. Only the
     relight leads, by the tens of milliseconds a modeset costs against a
     repaint. A desk that warns wants a lead time, and there are two shapes for
     one: a second timer in `crate::idle` with a config field saying how long
     before the blank to speak, or telling the shell the timeout and letting it
     count. Neither is written, and the lock above is what now wants one: it
     goes up in the same breath the glass goes out, so a person who was about
     to reach for the keyboard gets a lock screen rather than a warning they
     could have answered.

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

4. **A `backdrop-filter` over an `<app>`, half measured.**
   `guard-css-and-resize.sh` runs its eight cells a second time with a filter
   stacked over them, so every property is now read under one as well as on its
   own: viz applies the filter on the render pass aggregation has already
   inlined the window's quads into, and a filter with none of those quads to
   read leaves an `<app>` looking like nothing a `<div>` looks like. What that
   run cannot reach is the other half of the argument — that viz declines
   overlay promotion under a filter. It is headless and software-composited, so
   no quad was ever a candidate for a hardware plane, and the decline wants the
   same lit CRTC item 2 does.
   [WINDOW-COMPOSITING.md](docs/architecture/WINDOW-COMPOSITING.md).

5. **Strip what a desktop never runs.** The tab strip, the New Tab page,
   settings, sign-in and sync are built, shipped in the release tarball and in
   the attack surface, and a desktop can reach none of them. Measure per
   subsystem before patching — nobody knows whether it saves 5% or 40%. PDFium
   stays: a desktop should render a PDF in a window. The viewer UI is a separate
   question.

6. **The shortcuts inhibitor is measured against sway and a virtual keyboard,
   and nowhere else.** Patch `0038` asks the host compositor to stop matching
   its own bindings while the desktop's window has the keyboard — which is what
   makes a shell's Meta chords reach it nested at all. Two guards read it, and
   they are two claims. `guard-shortcuts-inhibitor.sh` reads
   `inhibit_shortcuts` off the engine's own `WAYLAND_DEBUG=1` capture: the
   engine **asked**. `guard-shortcuts-inhibitor-chord.sh` presses `Mod4+y`
   through a virtual keyboard into a sway that has a binding on it, and reads
   both ends — the binding's line on the host's side, the page's keydown on the
   other: with `--domicile-inhibit-host-shortcuts` the page must get it and
   sway must not, and without the switch the reverse. Each observer is shown
   able to see before its silence is believed: the binding fires once at an
   empty host, and a plain key reaches the page.

   What neither reaches: a host other than sway — mutter asks the user before
   it grants an inhibitor, so a nested desktop on GNOME may show a dialog
   nothing here has seen — and a physical keyboard, whose keys reach sway by a
   different device than `wtype`'s. [ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md)
   carries both guards.

   **Its first three runs on `crux` read neither end**: the engine segfaulted
   in `xkb_state_update_mask` under `WaylandKeyboard::OnModifiers`, modifiers
   with no keymap. The calibration press is a `wtype` of its own, and when it
   exits sway's seat has no active keyboard, so the engine bound one with no
   keymap. The guard now holds the seat again before the engine starts, and
   run 36234732979 read both ends, both ways. Still open, and Chromium's rather
   than this guard's: a host that sends no keymap takes the browser down on its
   first modifiers instead of leaving it decoding without one.

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
- **A dead compositor.** `pkill domicile-compositor`: expect a new desktop within
  a second and `starting the desktop again in 1s — that is failure 1 of 5 in a
  row.` The windows will not come back, which is the item above rather than a
  fault in the restart.
- **A dead engine, with windows open.** Start a desktop, put two clients on it
  — one that keeps drawing and one that is idle, a terminal nobody is typing in
  — and `pkill -f 'chrome.*--domicile-broker-socket'`. Expect, in order:
  `the engine exited`, `starting the engine again in 1s — that is failure 1 of
  5 in a row.`, one new engine and **no** second `domicile is up`; then, from
  the compositor, `the engine this desktop was drawing through has been
  replaced; rejoining it` and `rejoined the engine and restated this desktop to
  it shown=2 blank=0`. **The assertion is that both windows are still there,
  showing what they were showing** — the idle one especially, because nothing
  makes its client draw and it is the one a re-brokered sink alone would leave
  empty. `blank=` above zero, or an `on the page with nothing in it` line, is
  the failure this run exists to catch. Nothing in this container can reach any
  of it: there is no `libdomicile_engine.so`, no engine binary and no
  `/dev/dri`, so the launcher's half is proved by
  `scripts/test-a-desktop-that-fails-says-why.sh` against fake components and
  the compositor's half is proved only by unit tests over the decisions.
- **A desk left alone.** Run with `idle.blank_after_seconds = 60`, walk away for
  a minute, then touch the trackpad. Expect `nobody is at this desktop; its
  screens go dark connectors=N`, the panels off, and
  `somebody is at this desktop again; its screens come back on` with a
  `configuring N display(s)` behind it under `--vmodule=drm*=1`. Nothing here
  can see it: no runner has a `/dev/dri` at all, so every check this change
  brings is arithmetic over an injected instant. Plug a monitor in while it is
  dark for the second half — the new one must come up dark too.
- **A desk that locks with PAM.** Declare
  `security.pam.services.domicile = {};`, set `lock.pam_service = "domicile"`
  and `idle.blank_after_seconds = 60`, and walk away. Your password should give
  `the passphrase opened this desktop`; a wrong one should give `a passphrase
  this desktop did not take` a couple of seconds later — `pam_unix`'s delay —
  with the desk's clients still drawing throughout. The tests reach real
  libpam through `pam_exec` and a script standing in for the password check;
  `pam_unix` against a real password, and its setuid helper, are only here.
- **The latency run, on the panel.** From a console login, in a checkout, with
  the engine the flake pins:

  ```sh
  nix build .#engine
  nix develop .#full --command cargo build -p domicile-compositor
  ENGINE="$(readlink -f result)"
  nix develop .#full --command env OUT=. PLATFORM=drm \
    ./packages/domicile-engine/scripts/guard-latency.sh "$ENGINE"
  ```

  The verdict line is the guard's own: `commit to pixel` against the run's
  reported `display frame`, and the answer is the ratio rather than the
  milliseconds. A `PASS` there is the first reading of this taken against a
  real CRTC's frame. `answered too late` or `answered too soon` above zero
  means fewer rounds were measured than the run set out to.

  `OUT=.` because `nix build .#engine` produces a store path that *is* an out
  directory rather than a tree with one inside it, which is the same reading
  `pinned-engine.yml` takes. The guard is called directly, not through
  `scripts/engine-guard-latency.sh`: that one wraps the run in
  `under-wayland.sh` and takes `crux`'s render-node lock, and neither belongs
  on a laptop with a panel.
- **A desk of several monitors.** Plug one in and then a second, with
  `--vmodule=drm*=1`. Expect `configuring N display(s)` for each, a bar and a
  wallpaper on every panel, and `told the chrome about N display(s), from the
  window it named` once per monitor with N distinct names. Then: `mod+2` puts
  the keyboard on the monitor showing workspace 2 and leaves that workspace
  where it is; `mod+Return` opens the terminal on the monitor the keyboard is
  on; moving the pointer to another monitor moves the keys with it; and a
  window keeps drawing while every one of those happens. Nothing here can see
  any of it — no runner has a `/dev/dri`, and the shell half is arithmetic over
  an injected desk. The failure this replaces was three monitors with two pages
  on one of them, a third with none, and a terminal that answered the keyboard
  and drew nothing.
- **The first real `./scripts/dev-shell.sh <name>`.** Its reload is asserted
  against a `domicile` the test writes — `scripts/test-dev-shell.sh` drives the
  watch loop, the coalescing and a refusal — so what is left is a real engine
  taking a rebuilt shell: a saved edit on the screen, the windows where they
  were, and a shell that would not load leaving the desk on the one it had.
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
- **A monitor profile states a mode and cannot set one.** The stating half
  shipped: `mode = [3840, 2160]` on a placement is the mode that entry's
  positions were written for, and a monitor that comes up at another one
  leaves the desktop that is up alone with a complaint naming both — never a
  quiet fallback to the mode that arrived, which is the desk nobody can see is
  wrong. Left out, the monitor's own mode is used, as before. What is left is
  *asking*: `DomicileDisplayLayout` carries an id, an enabled flag and a
  corner, and `ModesetParamsFromSnapshots` configures every CRTC from that
  connector's `native_mode()`, so a profile can say which mode it needs and
  not which mode to take. A field on that struct and a mode lookup beside the
  native one is the fix, and that is the fork. The rate is the same item: a
  profile's mode is a size, because a hertz changes no arithmetic on this side
  and could not be chosen either.
  [A-DESKTOP-ON-A-TTY.md](docs/architecture/A-DESKTOP-ON-A-TTY.md).
- **A client that pre-rotates its own buffer is still wrong.** `wl_output.transform`
  invites it and nothing reads `wl_surface.set_buffer_transform`; the fix is in
  the dmabuf submit path.
- **A monitor that states no name at all can only be called `drm-<id>`.** The
  three-letter maker an EDID holds is spelled out now — the compositor reads
  hwdata's `pnp.ids` at run time, the `wl_output` states
  `Dell Inc. DELL U3219Q 2ZLS413`, and a profile matches that or the `DEL …`
  an EDID spells. What is left is the monitor that states neither make, model
  nor serial: its description is empty, so the int64 is the only name it has.
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
- **A nested desktop's browser reads the host's clipboard.** On a tty the
  engine reads and writes this desktop's — `ui/ozone/platform/drm/domicile/`
  holds the browser's end of it, and the compositor is the clipboard — but the
  ozone platform a nested run uses is Wayland's, whose clipboard is the session
  Domicile is a window inside. So a copy made in a terminal is not in a tab
  there, which is the split a tty no longer has. The fix is the same pair of
  `OzonePlatform` entry points implemented on that platform.
- **Nothing but text crosses to the browser.** A page that copies an image
  leaves every window outside the browser with no text to paste, which is what
  they are told, and an image copied in a terminal is not in a tab. The engine
  ABI carries a string; carrying bytes and a mime type is what it would take.
- **The clipboard's history holds text and nothing else.** A selection that
  offers only an image or a file list is not recorded — a list of previews is
  not a store, and a manager that drew a row it could not hand back would be
  worse than one that never drew it. The middle-click clipboard is not in the
  history either, deliberately: it changes on every drag over a word, so a
  history of it would be a history of what the pointer brushed past. It is
  carried between clients all the same —
  `zwp_primary_selection_device_manager_v1` is advertised, and
  `packages/domicile-compositor/tests/selection.rs` is the check.

- **A theme picked off the toggle lasts as long as the desktop does.**
  `[theme] mode` is what a desk comes up on and nothing writes back to it: the
  file is generated — by a shell, and on NixOS by home-manager — so a desktop
  that edited it would be overwriting a build product, and a reload would
  overrule the edit on the next rebuild anyway. What a click changes is the
  live desk, until it is restarted. Making it stick wants somewhere for a
  desktop's own state to live that is not the shell's generated config, and
  there is no such place yet.
- **Whether a Wayland window is in the theme wipe's old frame is unmeasured.**
  The windows turn inside the shell's view transition, once it has captured
  the frame it wipes away from — see `domicile_host::theme_turnover`. A
  `<webview>`'s guest was measured in that frame against the published engine;
  an `<app>` is embedded the same way, as a surface layer, and no pixel guard
  has yet put one under a transition. If it is not captured, a window shows
  through the wipe live and turns before it rather than behind it.
- **A portal frontend already running under another desktop is not
  re-routed.** `xdg-desktop-portal` reads which backend to use out of its
  *own* `XDG_CURRENT_DESKTOP`, so the compositor puts the name into the D-Bus
  and systemd activation environments at startup — which reaches a frontend
  activated after that and not one already up. A desk started from inside a
  sway session therefore keeps sway's portal routing until that frontend
  exits. That is a nested developer run rather than a desk somebody uses, and
  the real fix is the same one the whole session question wants: a session
  entry that names `domicile` before anything else in the session starts.
- **A domicile desk has no screenshot or screencast portal.**
  `xdg-desktop-portal-gtk` implements neither interface, and the backend that
  does on a wlroots desk — `xdg-desktop-portal-wlr` — screencopies through
  `wlr-screencopy-unstable-v1`, which this compositor does not serve. What
  keeps that backend out is its own `UseIn=`, which names wlroots, sway,
  Wayfire, river, phosh and Hyprland and not domicile; leaving it out of a
  desk's portal profile would not be enough on its own, because the frontend
  falls through the profile to `UseIn=` and then to a last-resort gtk. Closing
  it takes both halves: the protocol served (or an `impl.portal.ScreenCast` of
  our own over the engine's capture path) *and* the backend named where the
  frontend will look.
- **The settings portal answers one namespace and one key.** A desktop's
  backend usually carries GNOME's `org.gnome.desktop.interface` as well — the
  accent color, the interface font, the cursor theme — and Domicile has none
  of those to answer with. A backend that invented values would be worse than
  one that says it has nothing: a namespace nobody implements falls through to
  the next backend, which is the right answer and the reason the list in
  `nix/domicile.portal` is short rather than aspirational.
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
