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
trackpad and a click reach the page on real hardware. A desk left alone goes
dark and locks, and opens to its user's own password through PAM.

The evidence for each of those is in the doc that made the claim —
[ENGINE-FORK.md](docs/architecture/ENGINE-FORK.md),
[A-DESKTOP-ON-A-TTY.md](docs/architecture/A-DESKTOP-ON-A-TTY.md) — and in the
`packages/domicile-engine/scripts/guard-*.sh` that assert it.

## In this repository

1. **Keystroke to pixel, on a screen** (#206). `guard-latency.sh` reads 19–29 ms
   commit to pixel against a 16.67 ms display frame on `crux` — but in a nested
   compositor with nothing presenting, and with the probe's own round trip
   inside every figure. It reads that only on a quiet machine: beside another
   run's compile it read 36–49 ms, so the guard now waits until nothing else on
   `crux` is compiling or running guards before it takes the card (#601).

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
     carries six callbacks and none of them is a disconnect, so the compositor
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
   puts no clipboard row back, and a launcher's `search_files`,
   `preview_file` and `search_apps` are answered with nothing, whatever panel the shell left up to
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

   **And a shell can lock it on purpose**: `ChromeMessage::Lock`, which shuts
   the desk the way the idle edge does. manganese binds it to Mod+Shift+Return.

   What is left is

   - **A wrong passphrase is only `locked: true` again.** That is enough to say
     "that was wrong" — every verdict is broadcast, and a shell waiting on a
     check reads the state said again as the refusal — but it cannot tell a
     wrong passphrase from a verifier that could not check, count tries or
     rate-limit them. A verdict of its own would need an event of its own in
     the engine.
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

4. **Chrome extensions.** Installed from `[extensions]` in the config, their
   actions in the shell's tray with popups in a `<webview>`, and every
   `<webview>` a tab to `chrome.tabs`. Slice 1 is done: the fork installs what
   the config names, and manganese draws the actions in a tray on its bar and
   opens their popups in a `<webview>` under them. Slice 2 is in the fork:
   every `<webview>` is a tab and the desk one window, zoom included, a
   tray click grants `activeTab`, and an extension's popup window is one the
   shell draws.
   [EXTENSIONS.md](docs/architecture/EXTENSIONS.md).

5. **The system tray's menus.** Icons, titles and clicks work: the compositor
   hosts StatusNotifierItem and manganese draws the tray left of the
   extensions'. Left: `com.canonical.dbusmenu`, without which most
   libappindicator items do nothing on a secondary click.
   [SYSTEM-TRAY.md](docs/architecture/SYSTEM-TRAY.md).

6. **Which monitor toasts a notification.** The compositor serves
   `org.freedesktop.Notifications` — a site's Web Notification included — and
   manganese toasts them and keeps a drawer. Left: on one page over the desk,
   the toasts go to the top-right of the whole desk rather than the focused
   screen; and inline reply.
   [NOTIFICATIONS.md](docs/architecture/NOTIFICATIONS.md).

7. **Native density on every monitor.** On a tty the shell is one page over
   the desk's bounding box, hosted on the fastest monitor and presented on the
   rest, rastered at the largest scale, and each lower-density monitor's part
   also rastered at its own (a cc tiling per display scale). Left: the
   hardware check, and an `<app>`'s scale from the monitor under it.
   [ONE-PAGE-FOR-THE-DESK.md](docs/architecture/ONE-PAGE-FOR-THE-DESK.md).

8. **`domicile send-shell` from a terminal.** Keybindings are the config's and
   their `send-shell` actions reach the shell; the same action typed as
   `domicile send-shell focus right` has no route yet (supervisor → compositor
   → every page). [KEYBINDINGS.md](docs/architecture/KEYBINDINGS.md).

## In the engine fork — the agent on `crux`

1. **The shm upload, on a GPU.** An shm client's frame is drawn into a GBM
   buffer of the compositor's and submitted like a client's dmabuf. The copy
   is tested on llvmpipe; the allocation and the browser's import of it have
   never run, because no check has a render node.
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
   question. What a desktop's page could *trigger* is off already (#608): Chrome's
   accelerators, the context menu, zoom, overscroll navigation, the password
   manager, autofill, translate and WebAuthn's UI — but all of it is still
   built and shipped.

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
- **A dead GPU process.** `pkill -f 'chrome.*--type=gpu-process'`: expect the
  screen back within seconds and no `failed to take DRM master` line. Before
  patch `0074` the relaunched GPU process never got master and the desktop
  stayed dead.
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
- **A float dragged to the next monitor.** Two monitors, a floating terminal
  on the left, Meta+drag it right until its middle is past the edge. Expect it
  to be drawn over both while it crosses, land on the right monitor, and keep
  following the hand until release. A window that stops at the edge means the
  page stopped getting moves when the pointer crossed CRTCs — see
  [ONE-PAGE-FOR-THE-DESK.md](docs/architecture/ONE-PAGE-FOR-THE-DESK.md),
  *Input*.
- **A desk left alone.** Run with `idle.blank_after_seconds = 60`, walk away for
  a minute, then touch the trackpad. Expect `nobody is at this desktop; its
  screens go dark connectors=N`, the panels off, and
  `somebody is at this desktop again; its screens come back on` with a
  `configuring N display(s)` behind it under `--vmodule=drm*=1`. Nothing here
  can see it: no runner has a `/dev/dri` at all, so every check this change
  brings is arithmetic over an injected instant. Plug a monitor in while it is
  dark for the second half — the new one must come up dark too.
- **A desktop from a display manager.** Import `nixosModules.default`, set
  `programs.domicile.enable` and
  `services.displayManager.defaultSession = "manganese"`. The login screen
  should offer `manganese` and boot into it on the drm platform. Only the
  evaluation is checked here.
- **A desk that locks with PAM.** Set `programs.domicile.enable` from
  `nixosModules.default`, `lock.pam_service = "domicile"` and
  `idle.blank_after_seconds = 60`, and walk away. Your password should give
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
  real CRTC's frame. `answered too late` above zero means fewer rounds
  were measured than the run set out to.

  `OUT=.` because `nix build .#engine` produces a store path that *is* an out
  directory rather than a tree with one inside it, which is the same reading
  `pinned-engine.yml` takes. The guard is called directly, not through
  `scripts/engine-guard-latency.sh`: that one wraps the run in
  `under-wayland.sh` and takes `crux`'s render-node lock, and neither belongs
  on a laptop with a panel.
- **A desk of several monitors.** Plug one in and then a second, with
  `--vmodule=drm*=1`. Expect `configuring N display(s)` for each, a bar and a
  wallpaper on every panel, and `told the chrome about N display(s)`. Then:
  `mod+2` puts the keyboard on the monitor showing workspace 2 and leaves that
  workspace where it is; `mod+Return` opens the terminal on the monitor the
  keyboard is on; moving the pointer to another monitor moves the keys with
  it; and a window keeps drawing while every one of those happens. Nothing
  here can see any of it — no runner has a `/dev/dri`, and the shell half is
  arithmetic over an injected desk.
  Also: three identical monitors on one MST hub, plugged in together and one at
  a time, each lit with one window and no crash — the engine now places a
  connector no layout names past everything placed rather than at `(0, 0)`,
  and counts a window as its display's while its page loads, but nothing here
  has watched that on a desk.
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

- **A popup near a screen's edge is not moved back onto it.** A client's
  menu is placed where its positioner asks, relative to its window, because
  the compositor does not know where the page put the window — so the
  positioner's `constraint_adjustment` (flip, slide, resize) is never applied
  and a menu opened near an edge can hang off it. Fixing it wants the page to
  say where a window's box is on screen, or the positioner handed to the
  shell to solve. `popup_placed` in `domicile-protocol`.
- **A client is offered 8-bit formats only.** The engine imports four
  fourccs (`FOURCCS` in `engine.rs`), so a client that would draw in 10 bits
  draws in 8. Widening it is a `FormatFromFourcc` case in the fork and an entry
  there; `scripts/test-the-engines-fourccs-agree.sh` holds them together.
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
  GET of its action. A file input and a download's save location are answered
  too, by the shell — see *A file the page asks for* below.
- **A file the page asks for is half of what Chrome offers.** A file input and
  a download ask the shell (`domicile-file-chooser`). Still not routed: the
  File System Access pickers (`showOpenFilePicker`, `showSaveFilePicker`) and
  "save page as", which still open the portal's GTK dialog; a directory dropped
  on a page (`EnumerateDirectory`, refused); and a download's progress, which
  nothing reports — a large file arrives with no sign it is on its way.
- **A desk has no settings page.** A browser window is refused every
  `chrome://` page (patch 0083), and with them went the only place to clear
  cookies and site data, or to change a site's permissions. Nothing replaces
  them yet. Printing went too: `window.print()` opens `chrome://print`.
- **What a browser window's resize costs is unmeasured.** Patch 0054 stops the
  shell's frame waiting for a `<webview>` to draw at each new size, as it never
  waited for an `<app>`; no guard times a resize of either, so "it is as fluid
  as a terminal now" is reasoning from the deadline rather than a number.
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
  exits. That is a nested developer run rather than a desk somebody uses: a
  desktop started from a display manager has its session entry's
  `DesktopNames=domicile` before anything in the session starts.
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
- **Engine CI is one machine, and a cold build is four and a half hours.**
  `crux` has two runners, two Chromium trees and one compile slot, so an
  engine-moving pull request waits behind whichever one holds the slot, and a
  release built from nothing takes ~4h30m (#604's run, after its tree's build was
  reclaimed). A run that only needs guards can also wait: the latency guard
  holds out for a quiet machine for up to ten hours. The compiler cache is now
  shared between the trees (#611), and a job now drops the temp files nix
  leaks and never reclaims its own build (#612): 82G had leaked, which is the
  room earlier runs found by deleting builds and the compiler cache.

  **The shipped engine is optimized.** It was a non-official build with
  DCHECKs on, EXPENSIVE_DCHECKs included, because it was the same
  `out/Release` every pull request's checks run against. Now there are two
  builds: pull requests keep that one, and an official build (PGO, ThinLTO,
  no DCHECKs) runs nightly on the newest `main`, and is what users get. It is
  hours long, so it must never hold the slot against a pull
  request: a waiter now leaves a note beside the slot, and a holder can ask
  whether anybody is `wanted` and `yield` to them, resuming its build after.
  `engine-release.yml` is that build, publishing as `engine-official-` and
  landing `engine-official.nix` on main after each one; the flake runs it
  whenever it is of main's series (`engine-pin.nix`), and the checked engine
  in the hours between an engine merge and the next nightly. Measured: cold 8h15m,
  warm ~20m. The landing pull request is opened with the workflow's own token,
  so no other workflow runs on it; the url and hash are right by construction
  (`nix store prefetch-file`), and `nix-build.yml` resolves them on the next
  push to main.
- **Hot-swapping the chrome page is a page reload**, survivable only because
  `announce_open_apps` re-states the desktop to a page that has just loaded.
  `domicile load-shell` is what asks for one, so a shell that keeps state in
  its page loses it on every swap; the windows do not go, because the
  compositor never hears about any of this.

---

Working in this repository: [AGENTS.md](AGENTS.md) is the rules,
[docs/DEVELOPING.md](docs/DEVELOPING.md) is running, testing and debugging it.
