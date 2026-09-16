# Domicile roadmap

Domicile is a Wayland compositor whose **chrome is a web page**: panels,
launchers and window furniture are web content with full CSS, and an app's
window is a real element in it. It runs on a forked Chromium where `<app>` is a
`cc::SurfaceLayer` embedding a viz surface the compositor submits to — the
mechanism an out-of-process `<iframe>` and a hardware-decoded `<video>` already
use — so CSS applies to a window structurally rather than being reimplemented
against it.

| Read this | For |
|---|---|
| `docs/architecture/ARCHITECTURE.md` | why any of this |
| `docs/architecture/ENGINE-FORK.md` | the fork: the design, the series, what is measured |
| `docs/architecture/WINDOW-COMPOSITING.md` | how a window reaches native cost |
| `docs/WRITING-A-SHELL.md` | the shell author's view |
| `AGENTS.md` | how to work in this repository |

Built test-first, from the pure-logic core outward to the hardware glue.

---

## Where it stands

`domicile-compositor` is the Wayland server — Smithay, the globals, the seat,
the surfaces, the dmabuf import — and it does not draw. Each client's buffer is
submitted to the engine as a viz surface, and the page embeds that surface in
its `<app>` element, so nothing is copied by the CPU and the browser's own
display compositor is what reaches the screen.

`domicile` is the entry point: `domicile ./my-desktop/dist/shell.js` starts the
engine and the compositor, in the one order they can start in — the engine
first, because it serves the shell over `domicile://` and opens the broker
socket the compositor connects to as a producer. It builds nothing and wraps
nothing: both components ship beside it, the way a multi-binary program like
postfix does, and it finds them from its own path. There were three, and the
bridge that served the page over a loopback HTTP port is gone with the port.
It also answers a control socket of its own — `domicile-ipc.<pid>.sock` under
`$XDG_RUNTIME_DIR`, announced to its apps as `DOMICILE_SOCK` — which is how a
desktop is asked a question rather than restarted, and how one of several is
asked rather than another.

The wire protocol is at `PROTOCOL_VERSION = 1`.

### What is proven, and by what

| Claim | Evidence |
|---|---|
| A window composites at native cost | A submitted frame reaches the display compositor's output in one display frame, indistinguishable from the probe's own floor. `ENGINE-FORK.md`, *What it costs* |
| CSS is structural, not reimplemented | Seven properties measured on a GPU — `z-index` against ordinary DOM, `transform`, `border-radius`, `opacity`, `filter: blur()`, `mix-blend-mode`, resize — every one bit-exact against an ordinary element beside it. `ENGINE-FORK.md`, *What CSS does to an `<app>`* |
| `<app>` and `<webview>` are elements the fork defines | Patch 0007. `document.createElement("app").constructor.name` is `HTMLAppElement`; `app-id` reflects both ways |
| A shell loads over `domicile://`, with no port behind it | Patches 0008 and 0009: a standard scheme, deliberately not web-safe, both loader hooks, the document the fork writes, and `navigator.domicile` bound for that origin — a stand-in compositor read `hello` and a `spawn` back over it. Five gates stand between a registered scheme and a page that loads and all five are through, the last of them `MaybeLaunchAppShortcutWindow`, which declines `--app=domicile://shell/` for a scheme that is not web-safe and launches an ordinary browser window on the New Tab page instead, logging nothing on either side. No desktop binds a loopback port any more: the process that served one is gone, and `connectToHost` takes the host off a global rather than opening a WebSocket |
| A shell reaches the compositor at `window.domicile` | `window_domicile.idl` and `WindowDomicile`, a `STATIC_ONLY` forward to the `NavigatorDomicile` supplement, so the two spellings are **one object** rather than two channels to one compositor. Evidence it actually binds is `guard-shell.sh` in engine CI: it builds a real shell whose SDK reads `window.domicile`, so a binding that never bound shows up there as a desktop with no window in it. `navigator.domicile` still answers, and is where it lives |
| A `<webview>` is a guest, so a site that refuses framing loads in one | `guard-webview-framing.sh`. The element shows a page sending `X-Frame-Options: DENY` and `frame-ancestors 'none'`; its control frames that page and a copy differing only in those two headers from an ordinary http page, and shows the copy and not the original. So the site is refused where it has an ancestor, and the element is not giving it one |
| A desktop chord reaches the shell while a browser window has the keyboard | `guard-webview-keyboard.sh`. A key pressed before focus moves reaches the shell's `document`; the chord after it comes back as `shortcut` and the window never sees it; an ungrabbed key reaches the window's page and not the shell |
| A click inside a browser window reaches the shell that has to raise it | `guard-webview-click.sh`. A press driven at the engine lands in the guest's own page and arrives in the shell's `document` as an event on the element the guest hangs off, which is what a shell raises the window on; its control clicks the shell's own chrome instead and nothing reaches the element. Patch 0011 is both halves of why it crosses: upstream dispatches no focus event across a remote frame's process boundary, and focusing the element across it dispatches none either — Blink suppresses focus events while the page is unfocused, which a guest taking focus always makes it — so the element says so in an event of its own. The first run of the guard, with only the focus, is what found the second half |
| A browser window can say whether back and forward are available | `guard-webview-history.sh`. `CanGoBack()`/`CanGoForward()` are answers only the browser process has, and they reach the page as `canGoBack`/`canGoForward` properties on the element plus a payload-free `domicile-history-change` event. Properties rather than event payload on purpose: a DOM event dispatched before a React shell's first effect flush is gone, so a late-mounting chrome reads the state it missed instead of having had to be listening. Note `ShouldEnableBackButton()` is not the same question — it is true when only skippable entries remain, because Chrome uses it for the long-press menu, and a button grayed in from it does nothing |
| What the browser-to-renderer hop costs | Every `ControlChannelClient` method carries a `mojo_base.mojom.TimeTicks arrival`, stamped once per socket read rather than per parsed message — a read can carry several, and stamping at parse time would price the JSON parse into the second and later ones, so a batch read would report a hop that grows with position in the batch. Converted through `WindowPerformance`, so `event.timeStamp - event.arrival` is the stage and not arithmetic in the renderer. Measured at 0.300 ms and 0.200 ms. **On the socket path only**: `ShortcutPressed` and `Modifiers` also have a registry path stamped elsewhere that nothing measures, and `Displays` dispatches a bare `Event` and is deliberately unstamped |
| A client's dmabuf imports on AMD | Patch 0005, confirmed on a Radeon 890M on 2026-09-08: kitty survives being floated and resized, on the DCC modifier that used to be refused, with no `gbm_bo_import` failure in the run |
| The desktop a user runs contains all of it | `packages/domicile-engine/engine-release.nix` pins the published engine; `nix run github:cprussin/domicile#manganese` runs it |

---

## What we are tracking

Ordered within each group. Grouped by **who can do it**, because that is what
decides whether an item is waiting or workable.

### In this repository

1. **`<app>`, not `domicile-app`.** **Both tags have landed**, and what is
   left is the subtraction at the bottom of this item. `<webview>` went first:
   `DomicileWebviewElement` forwarded every call to a native `<webview>` patch
   0007 already owns — `src`, the four history controls, both availability
   properties and both events — so it went, `alias-tags.ts` went with it, and
   the shells write the tag. `WRITING-A-SHELL.md` moved in the same change,
   because it is the contract that breaks.

   **`<app>` has landed too, and it works — but it did not when it merged, and
   what was wrong is worth knowing.** The shells write the fork's tag and the
   embed runs through `HTMLAppElement::Embed`. The design held up: there is no
   registry, because `DomicileClient` already sees every size message pass its
   own listener, so `surfaceSizeOf(appId)` answers on demand; only `app_resized`
   became the SDK's business, and `app_cursor` deliberately stayed the shell's,
   because a cursor needs a push and a size is only ever input to the SDK's own
   arithmetic.

   **The embed did not, and the cause was a line neither element had.** Engine
   run 34699945195, step 16 — "A shell on the fork, showing a real client's
   window" — failed with `appeared=1 brokered=1 configured=1 drew=0` for the
   shell, no embed line in its engine log at all, and `engine has not drawn
   #FF19B36B anywhere`. Everything upstream passed, including a client's window
   on the page via the canvas path and its negative control.

   Neither `HTMLAppElement` nor `HTMLWebViewElement` overrode
   `Node::GetElementType`. `HTMLElement`'s base answers `kHTMLElement`, and the
   `DowncastTraits` Blink generates for a tag in `html_tag_names.json5` is
   `node.GetElementType() == ElementType::kHTMLAppElement` — so every
   `DynamicTo<HTMLAppElement>` returned null. `LayoutAppSurface` casts the node
   back to hand the element the box layout gave it; the cast said no,
   `SurfaceBoxChanged` was never called, `configured_size_` stayed empty, and
   `Embed()` returned at its empty-size guard on every layout. **A window that
   is never asked for is a window that never arrives**, and nothing anywhere
   logged a failure, because nothing failed. `node.h` states the rule — "every
   HTMLElement must override this so that callers can ask for the type" — and
   nothing enforced it.

   **`<webview>` was bitten first and the diagnosis was missed.** Patch 0011
   read `DynamicTo<HTMLWebViewElement>` returning null out of a real click,
   wrote the anomaly into a comment, worked around it with `HasTagName` — which
   was right for its own reasons — and concluded the traits "work for `<app>`".
   They never had. One missing line, two elements, two separate days spent
   somewhere else.

   **It merged green because nothing tested it, and something does now.**
   `engine.yml` triggers on `packages/domicile-engine/**`, the change touched
   none of it, and the five checks that ran contain nothing that puts a window
   on a screen. Every guard that passed uses `canvas.embedExternalSurface` —
   `spike-page.html`, `spike-css-page.html`, `spike-resize-page.html` and
   `guard-two-windows.html` all do, so the resize guard patch 0011 cited as
   proof of the cast measures the canvas path too. `guard-shell.sh` is the only
   thing that drives the native tag, and it is green on both shells now.
   `scripts/test-fork-elements-know-their-type.sh` is the cheap half: it reads
   the elements the series adds to `html_tag_names.json5` out of the patch and
   fails if a header does not say its own type. No Chromium tree, so it runs in
   the shell group on every push rather than only when the fork is touched.

   Then the subtraction it exists for: delete the placement machinery —
   `measure.ts`, `observe-placement.ts`, `element-transform.ts`, `matrix.ts`,
   `placement-timing.ts` — because an `<app>`'s layout box *is* the
   `xdg_toplevel.configure` and patch 0007 reports it natively.
   `ExternalSurfaceProvider::Embed` already carries the size, so `resizeApp`
   from the chrome is redundant once the tag is native, and `offsetX`/`offsetY`
   on the `<app>` is the engine answering the other half of `measure`'s job with
   the real transform. That step is the one with the measurements behind it.

   **The placement deletion is unblocked, and the numbers under it are now
   the right numbers.** It was waiting on the embed working, and a guard shows
   a client's window through the native tag on both shells. The evidence has
   caught up: `spike-css-page.html` and `spike-resize-page.html` write
   `<app app-id="…">` rather than embedding through a `<canvas>`, and the
   tables in `ENGINE-FORK.md` were re-taken on `crux` — software and GPU — with
   **not one number moving**. The row that matters most to this deletion is
   resize, and it changed in kind: the page now grows a CSS box and nothing
   else, and the producer is reconfigured from `120x90` to `180x130` off
   layout alone. That is "an `<app>`'s layout box *is* the
   `xdg_toplevel.configure`" measured rather than argued, which is the sentence
   `measure.ts` and `observe-placement.ts` are being deleted on the strength
   of. `report-app-sizes.ts` was rebuilt document-level rather than dropped for
   exactly this moment, with a header saying it is redundant and why; it comes
   out with the rest.

   **What is not yet arranged is the thing that would catch it going wrong.**
   `guard-shell.sh` is the only check that drives the native tag end to end,
   and it runs in `engine.yml`, whose path filter is
   `packages/domicile-engine/**` plus this workflow and its scripts.
   `packages/chrome-sdk/**` is not in it -- so the deletion, which is entirely
   inside the SDK, would merge with the unit tests and nothing that puts a
   window on a screen. That is the same hole the missing `GetElementType`
   override went through, described three paragraphs up, and it is worth
   noticing *before* rather than after this time.

   Three ways out, and the choice is a cost decision rather than a technical
   one. Add `packages/chrome-sdk/**` to the filter and every SDK change queues
   behind the most expensive job in the repository, which can be hours. Make
   the shell guard dispatchable on its own, the way `engine-drm-probe.yml`
   already is for the same reason. Or run it deliberately once, against the
   deletion, and merge on that. The second is the shape the repository has
   already chosen once; the first is the only one that keeps working when
   somebody forgets.

   A FOURTH THING IS ALSO TRUE and narrows what can be deleted: `measure` is
   not only the placement path. `pointer-input.ts` asks it for the element's
   `{size, transform}` and inverts that affine in `surfaceLocal`, which is what
   makes a click land correctly on a window under a CSS rotation rather than be
   approximated by its axis-aligned box. `offsetX`/`offsetY` from the engine
   answer where a window is, not what it is transformed by. So the deletion is
   `observe-placement.ts`, `placement-timing.ts`, `report-app-sizes.ts` and
   `resizeApp` -- the reporting path, which the engine has genuinely replaced
   -- while `measure.ts`, `element-transform.ts` and `matrix.ts` stay until
   something answers the pointer's question. Splitting it that way is also what
   makes the first half verifiable in one guard run rather than two.

   Two things are deliberately still on the canvas path and neither blocks the
   deletion. `scripts/spike-iframe.sh` compares an `<app>` against an
   out-of-process `<iframe>`, and the re-take is what makes leaving it
   tolerable — the two call sites agree to the pixel, so its `<app>` column is
   the same column either way. The bands measurement is older than both and is
   a record of a rejected design, not a claim about the current one.
2. **Keystroke-to-pixel latency** (#206). The requirement is that a client's
   window costs the user nothing a plain Wayland compositor would not.
   `guard-latency.sh` has run on `crux` now — it reads `commit to pixel` at
   28–29 ms against a 16.67 ms display frame on every run so far, which is 1.7
   frames and no stage of its own. What is left is a machine with a screen: the
   runs are in a nested compositor with nothing presenting, and the probe's own
   round trip is inside every figure.

   The chrome-side instruments are gone rather than empty. `roundTrip`, `hop`
   and manganese's `drawTiming` were deleted with the diagnostic line they fed,
   because a shell reading an instrument nothing records into printed
   `rt_ms=0` every interval anyone typed — and a zero is a measurement to
   whoever reads the log. `latency.rs` is where the compositor-side
   measurement lives. The engine stamp the browser-to-renderer hop needed has
   since landed, so that hop is a number rather than an assertion — see *What
   is proven* above for which of the three paths it actually covers.
3. **`domicile load-shell <path>`.** **The socket is in.** A running desktop
   takes `$XDG_RUNTIME_DIR/domicile-ipc.<pid>.sock` before it starts anything,
   answers newline-delimited JSON on it, and unlinks it when the run ends;
   `domicile which-shell` works end to end. The path is exported as
   `DOMICILE_SOCK` onto the compositor, so an app inherits the way back to the
   desktop it is running in — sway's `SWAYSOCK` arrangement, and per-instance
   for the same reason `WAYLAND_DISPLAY` is. **A session may hold any number of
   desktops**, each answering its own socket; a client with no `DOMICILE_SOCK`
   is refused by name rather than sent to guess between them.

   **The engine's half is in and the supervisor's is not.** The engine takes a
   `--domicile-command-socket` of its own, answers
   `{"type":"load_shell","version":1,"root":…,"module":…}` on it with `loaded`
   or `refused`, and carries one out by replacing what `ShellSource` holds and
   reloading the shell's window — the windows survive it, because the
   compositor is not in the path.
   `docs/architecture/THE-DOMICILE-BINARY.md` has the route and why the other
   one was refused.

   What is left is three things in `domicile-launch`:
   `--domicile-command-socket` on the engine's command line in `spawn`, a
   `load-shell` verb in `cli` and `control`, and `answer` dialing the engine
   instead of holding the answer itself. **None of it works before an engine
   release carries the socket** — `engine-release.nix` pins an engine built
   from an older commit than `main`, and the running one has never heard of the
   switch, so a supervisor that dialed it now would find nothing listening.

   **Dev reload comes back with `load-shell` and not before.** The poller the
   bridge wrote into every served document went with the bridge, the C++ that
   writes the document has nothing in its place, and `DOMICILE_DEV_RELOAD` is
   gone rather than left switching nothing on — so `scripts/dev-shell.sh` is
   still right that a rebuilt shell needs the desktop restarted.

4. **What living in it needs and it does not have.** Named here rather than
   discovered on the first day somebody tries to stay in this desktop, because
   none of it is in `A-DESKTOP-ON-A-TTY.md` -- that document audits getting a
   desktop *up*, and these are all about keeping one.

   - **Suspend and resume are unhandled.** Nothing re-establishes DRM master
     or re-modesets on the way back, and nothing in this repository mentions
     either. Close a lid and the honest expectation is a desktop that does not
     come back.
   - **Nothing restarts a component that dies.** `domicile-launch`'s
     `supervise` watches for an exit and *reports* it; there is no respawn. An
     engine crash is the whole desktop, which also makes a shell author's
     mistake cost more than it should.
   - **No idle, no lock, no DPMS.** A desktop you walk away from is one anybody
     can walk up to, and blanking a screen after a timeout is the same seam.

   The order above is the order they bite. None of them is the fork's: the
   first is the compositor's and the launcher's between them, and the other two
   are this repository's outright.

### In the engine fork — the agent on `crux`

1. **A desktop on a tty.** Audited against the pin in
   `docs/architecture/A-DESKTOP-ON-A-TTY.md`. Getting `gn gen` to accept
   `ozone_platform_drm = true` is a **patch**: nine edits, eight of them around
   the DRM platform rather than inside it, because its 49 `.cc` files hold two
   ChromeOS references between them and no `BUILDFLAG(IS_CHROMEOS)` at all — the
   assert is conservative about the platform. Getting a lit screen out of it is
   a **port**, of the embedder ozone/drm has never had off ChromeOS: no
   `PlatformScreen` (`CreateScreen()` is `NOTREACHED()`), nothing that calls the
   modeset seam, no VT handling or input revocation, and no route by which a
   display list reaches the compositor. It is **not a fork**.

   That the patched tree configures **and compiles and links** is now
   **measured, not reasoned**: `.github/workflows/engine-drm-probe.yml` builds
   `//ui/ozone` with the argument on and the patch applied, on the engine
   runner, and it is green -- `ozone_platform_drm = true configures and
   //ui/ozone compiles at this pin`. It earned its keep immediately: three of
   the eight edits exist only because it ran, and one of them was a link error
   that no `git grep` and no compiler could have reached. Five edits was the
   reading; eight is the count, and the gap between those two numbers is the
   argument for owning a runner.

   What has *not* been measured is a lit screen. The probe builds `//ui/ozone`,
   not `chrome`, so nothing here says a display comes up -- only that the tree
   the display would come out of builds.

   **`DrmScreen` has landed -- patch `0013`, 12 unit tests in
   `ozone_unittests`, all 733 of that suite green.** It answers
   `CreateScreen()` and `InitScreen()`, which were both `NOTREACHED()`, over
   `display::DisplayList` and `display_finder.h`, and none of
   `//ui/display/manager` was ported. What is **not** measured is any of it
   running: nothing has started `chrome` under the platform, so the screen is
   correct against its tests and unexercised against a browser. The modeset
   driver beside it is the next item -- it landed the same night, and both of
   those sentences are answered below.

   **Step 2 was costed as two files rather than a port of
   `//ui/display/manager`, and both came in at that size.** Only that target's *caller* is ChromeOS-only:
   `DrmNativeDisplayDelegate` already implements `GetDisplays`, `Configure`,
   `TakeDisplayControl`/`RelinquishDisplayControl` and a two-method observer,
   and every one of those seams is ungated. `PlatformScreen` has nine pure
   virtuals of which six are delegations to `display::DisplayList` and
   `display_finder.h`; the model is `HeadlessScreen` at 306 lines, not
   `WaylandScreen` at 737. `A-DESKTOP-ON-A-TTY.md` has the tables, read at the
   pin.

   **The next measurable step is a run, not a reading -- and `crux` can now
   make it.** In order: `chrome` builds with the argument, then `chrome
   --ozone-platform=drm` *starts* without hitting a `NOTREACHED()`, then a CRTC
   lights. **The first two have now been run, and they answer differently.**

   `chrome` builds with the argument -- but only after a ninth edit, which the
   build found the way it found the eighth. `drm_util.h` declared two constants
   whose initializers call `FeatureList::IsEnabled()`, which every including
   translation unit then runs during static initialization; that is fatal, and
   it killed `v8_context_snapshot_generator`. Both are functions now.

   The trap on the way there is worth keeping even though the milestone moved
   past it: `out/Agent` took the argument into its `args.gn` a day after its
   `chrome` was linked, and that binary aborted in `GetOzonePlatformId` with
   `Invalid ozone platform: drm` before a line of fork code ran. **An `args.gn`
   carrying an argument is not a binary built with it**, and comparing the two
   timestamps is what says which.

   `chrome --ozone-platform=drm` got as far as `DrmWindowHost::GetBoundsInDIP()`
   under `WindowTreeHost::InitHost()` -- the same ChromeOS-shaped refusal as the
   `CreateScreen()` one just cleared, twenty frames out. **That box is closed,
   and it was seven boxes rather than one.** `DrmWindowHost` holds seven
   `NOTREACHED()`s; answering the two the costing named moves the crash to
   `SizeConstraintsChanged()` under `DesktopNativeWidgetAura::InitNativeWidget()`,
   and a run on the build host established that with bodies in all seven **the
   browser process stops failing entirely** -- it creates its window and goes on
   to ask viz for a root compositor frame sink. So all seven landed together
   (patch `0015`) rather than one four-hour build at a time.

   **The modeset driver landed beside it (patch `0016`), and the shipped engine
   now carries the platform.** `scripts/build.sh` and `engine-release-build.sh`
   both name `ozone_platform_drm = true`, which is the last item of step 2 that
   is not about a screen. Four patches went in tonight -- `0014` a feature flag
   read during static initialization, `0015` the seven methods, `0016` the
   modeset driver, and the build argument on top of them.

   **What stands next is not an embedder method, and that is the finding.**
   Past the seven, the GPU process dies: ozone/drm refuses software compositing
   by design and the run had fallen back to it after three GPU process restarts
   on an incomplete GL framebuffer. `GetPreferredEGLDevice()` chooses a render
   device and `GetPrimaryDisplayCardPath()` chooses a scanout card, and both ask
   the same `GetPreferredDrmDrivers()` -- which upstream can do because on
   ChromeOS they are the same device. On `crux` they cannot be: the card with a
   connected connector has no render node, and the card with the render node has
   nothing plugged into it. The build host has since confirmed the render-node
   mismatch. `A-DESKTOP-ON-A-TTY.md` step 2 carries it, and it is a device
   question rather than a porting one.

   Both of those runs were made without taking the engine tree lock, and CI
   reset the checkout twice inside the build window, so **repeat them under the
   lock before quoting them as measurements** -- as a dispatched CI job, which
   takes the lock by construction and ends in a run URL a doc can cite. What
   each finding rests on is readable in the source either way; what is in doubt
   is the binary, not the diagnosis.

   `0014` was repeated under the lock and is a measurement. The seven-methods
   finding and the GPU trace were not, and the patches they drove are in main
   on the strength of the source rather than of those runs -- which is the
   trade this paragraph describes, taken deliberately rather than forgotten.
   What would settle them is one build of `chrome` under the lock with the
   series applied, and that is cheaper now than it was: the shipped build
   carries the platform, so an ordinary engine run compiles it.

   The two steps after that were blocked on a card node, and
   `crux` has one -- `/dev/dri/card0` is **vkms**, whose `Virtual-1` connector
   reads `connected` at a preferred 1024x768@60, with GBM up and a 256x256
   XRGB8888 scanout bo allocated on it (`drmprobe/probe`, read-only: it calls
   neither `drmModeSetCrtc` nor `drmSetMaster`). `card1` is the nvidia GPU and
   all four of its connectors read `disconnected`.

   A vkms CRTC presents to nobody, so it answers "does the modeset path run"
   and not "does a desktop appear". That reading survives -- but the second half
   is now known to be **unreachable on this machine at any cost in code**, which
   it was not when this was written. vkms takes a GBM device and then refuses an
   EGL window surface (`EGL_BAD_MATCH`), so nothing renders on the card that has
   the connected connector; `renderD128` renders fine and belongs to the card
   with four disconnected ones. Putting a frame on the lit connector would mean
   rendering on one card and scanning out on another, which ozone/drm cannot do.
   So "does the modeset path run" needs no new hardware and "does a desktop
   appear" needs a monitor on `card1` or a different machine.
   `A-DESKTOP-ON-A-TTY.md` carries the numbers. Treat the costing as a floor:
   the last audit read five edits and the compiler found eight.

   **Step 2's code is done -- four more patches -- and of it only the modeset
   has run on a screen**, in the run recorded below. Keep those two halves
   together; the rest of this item is the first and the paragraph after it is
   the second.

   `0017` is the VT switcher: `VT_SETMODE` in `VT_PROCESS` mode, a signal per
   edge, and the handshake as a free function with eleven tests, because a
   relinquish that fails has to refuse the switch rather than hand the console
   to the kernel while Chromium is still scanning out.

   `0018` is **the black screen, and it was never the display list.**
   `ScreenManager::FindWindowAt` compares a window's rectangle to
   `gfx::Rect(controller->origin(), controller->GetModeSize())` for *exact*
   equality, and Chromium's default window is `kWindowMaxDefaultWidth` wide
   inset by ten pixels -- 1050x1900 at (10,10) on a 2880x1920 panel. No match
   means no controller, and every frame is dropped before the kernel sees it,
   with nothing wrong in any log because nothing went wrong. `domicile-launch`
   passes `--start-fullscreen` on the scanout platform only, and `DrmWindowHost`
   answers `SetFullscreen` and `GetPlatformWindowState`, both of which were
   stubs on `0015`'s premise that ash sizes its own root window. Nothing in
   `chrome/` is touched, and the revision of `0018` that touched it is what the
   second tty run below found: the `--app=` path already reaches
   `MaybeToggleFullscreen`, through the `FinalizeWebAppLaunch` call
   `MaybeLaunchAppShortcutWindow` already makes.

   `0019` is **the browser dropping DRM master, because the GPU process never
   could.** Not a sandbox and not a permission bit: `drm_set_master` marks the
   fd `was_master` when the browser's open takes master on a bare tty,
   `drm_file_update_pid` then refuses to refresh the recorded pid for any fd
   that was ever master -- deliberately, so `drm_master_check_perm` keeps
   working -- and `SCM_RIGHTS` hands the GPU the same `struct drm_file` with
   that frozen pid in it. A `dup` kept in the browser shares the one
   `drm_file`, so the drop takes effect for the GPU's copy and the caller's
   tgid is the recorded one. The GPU keeps honest `has_master()` bookkeeping
   without the ioctl, which is load-bearing rather than tidy: left saying yes,
   `DrmWindow::SchedulePageFlip` commits a frame while the console belongs to
   somebody else, the atomic plane manager has no EACCES exemption, and
   `PageFlipWatchdog` ends fifteen seconds later in `LOG(FATAL)`.

   `0020` is **input from logind, so no user is ever in the `input` group.**
   `TakeControl`, `TakeDevice` per device, `PauseDevice`/`ResumeDevice`, over
   Chromium's own `dbus::Bus` rather than libseat -- D-Bus is already compiled
   into this engine and in use by the browser process, so it adds no
   dependency. The seam was already there: `InputDeviceOpener` is a one-method
   interface the factory takes as a constructor argument, and the whole bug was
   one bare `open()`. A resume is a **reopen**, not a `dup2`: the kernel drops
   the epoll registration with the description behind it, and
   `AttachInputDevice` is the only caller of `Start()` -- so without that,
   `0019`'s working `Ctrl+Alt+F<n>` and this would have shipped together as
   "switch away, switch back, keyboard dead", which is worse than the group
   membership they replace.

   **None of those four had been exercised when they landed**, and the run
   below has since exercised none of them either. They rest on source read at
   the pin, unit tests (`DrmFullscreenTest`, `DrmMasterTest`, `DrmInputDevicesTest`,
   `DrmVtSwitcherTest`), and an engine build that compiles and links. `crux`
   still cannot answer the other half -- vkms has the connected connector and
   refuses an EGL window surface, `renderD128` renders and belongs to the card
   with four disconnected ones -- so the first real evidence will be a run on a
   machine with a monitor, and every one of these four is a candidate to be
   wrong there in a way no test here can see. The black screen `0018` fixes is
   exactly that shape: three prior patches were correct and the desktop was
   still dark.

   **The first run on a tty with a connected panel has now happened, and the
   modeset worked.** `the DRM thread confirmed the modeset` on a 2880x1920@120
   connector -- `0016` doing what it was written to do, on hardware, for the
   first time. Nothing drew, because the browser process SEGV'd about 200ms
   later, and `0021` is that crash. `0017`, `0018`, `0019` and `0020` are still
   unexercised: the run ended before anything could ask them anything.

   `DrmWindowHost::Close()` was `{}` -- upstream's, not the fork's, and the
   only Ozone platform whose `Close()` does not end in
   `PlatformWindowDelegate::OnClosed()`. That call is what completes a close:
   it nulls the platform window and destroys the host. Without it
   `DesktopWindowTreeHostPlatform::CloseNow()` destroys the compositor, asks
   the platform window to close, and is told nothing -- so the host survives
   half-destroyed, and the widget's own destruction later dereferences the
   compositor that is already gone. **The same species as `0015` and `0018`: a
   stub whose premise is that ash never routes a window through
   `DesktopWindowTreeHostPlatform`, reached by a views browser on a tty.** It
   is one call with no decision in it, so what guards it is
   `scripts/test-a-closed-drm-window-says-so.sh` reading the series, not a
   gtest.

   The crash trace named `StatusIconWidget`, and **that is an ICF fold rather
   than the widget**: the deleting destructor of any `views::Widget` subclass
   that adds no members folds with `views::Widget`'s own, `symbol_level = 0`
   leaves the symbolizer naming the folded address from whichever symbol it
   meets, and on a Linux build that class is the only anonymous-namespace
   `views::Widget` subclass there is to meet. It cannot have been the status
   icon: `supports_system_tray_windowing` is false on ozone/drm and
   `StatusIconButtonLinux` refuses to build its widget without it. Read a
   folded frame as a fact about the *group*, not the name.

   **The second run got all the way up and still drew nothing**, and `0018`
   was why. Modeset confirmed, compositor serving, chrome connected and
   handshaken -- and the chrome reported a desktop of 1050x1900, which is
   Chromium's default app window on that panel to the pixel. `0018`'s ozone
   half was right and its `chrome/` half was a second caller: the `--app=`
   path does reach `StartupBrowserCreatorImpl::MaybeToggleFullscreen`, because
   `MaybeLaunchAppShortcutWindow` calls `web_app::startup::FinalizeWebAppLaunch`
   and that function's last statement is exactly it. So `--start-fullscreen`
   was never being dropped, the patch's extra `chrome::ToggleFullscreenMode`
   ran on a window that had *just* gone fullscreen, and
   `FullscreenController::ToggleFullscreenModeInternal` reads
   `enter_fullscreen = !context->IsFullscreen()` -- so it exited, and
   `DrmWindowHost` put the window back on the `restored_bounds_` it had
   recorded a moment earlier. A patch that made a stub work, and then undid
   the only thing calling it. What guards it now is
   `scripts/test-the-fullscreen-flag-is-honoured-once.sh`, reading the series:
   the DRM window must answer a fullscreen request with new bounds, and the
   series must add no second toggle to startup. `0017`, `0019` and `0020`
   remain unexercised.

   What is left of step 2 after a screen lights: a **`drm` arm in
   `domicile-launch`'s `platform()`**
   so a machine with no `WAYLAND_DISPLAY` gets a tty rather than a refusal,
   which is auto-detection only and blocks nothing because `OZONE=drm`
   overrides outright; and **taking the card node from logind too**, which is
   how wlroots does VT switching and would supersede `0019`'s `dup` and remove
   the browser's own `open()` of the card.

2. **What the engine ships that a desktop never runs.** Chrome carries a tab
   strip, a New Tab page, a settings UI, sign-in and sync. A desktop can reach
   none of it, all of it is built, and all of it is in the ~216 MB release
   tarball and in the attack surface. **Measure before patching**: nobody knows
   whether stripping it saves 5% or 40%, so the work starts with a size figure
   per subsystem and a list of what each `enable_*` argument actually removes.

   One decision is already made. **PDFium stays** — a desktop should render a
   PDF in a window, so `enable_pdf` is not a free win. The separable question is
   the viewer UI (`chrome/browser/resources/pdf` and the
   `//extensions/browser/mime_handler` dependency it drags in), which is a
   different subsystem with a different answer.

### Needs a machine with a screen

Nothing here can see one. Say which question a run would answer rather than
guessing between two.

- The first real `./scripts/dev-shell.sh <name>`.
- Anything about orientation, presentation, or what a display does with a
  buffer.
- Re-measuring latency or CSS parity after a change that could move either.

### Undecided

- **Translucent chrome over a window with anything painted behind it.** The
  page cannot see the window's pixels, so a `backdrop-filter` on chrome stacked
  over a window has nothing to blur. Four ways out are costed in
  `WINDOW-COMPOSITING.md`; raster-per-band is where it goes, and its open part
  is transport rather than rendering.
- **`wl_shm` clients.** A client that draws into shared memory has no dmabuf to
  import, so its window is blank and the compositor says so once per client.
  The upload that would give it one does not exist — `ENGINE-FORK.md`, phase 2.

---

## Known gaps

True, understood, and not scheduled. Each is here so that finding it again
costs nothing.

- **A frame in which the chrome repainted reports the whole output damaged.**
  The chrome is one layer covering the desktop, so its commit counter moving
  damages all of it — and it repaints for a clock, a caret, a hover.
- **A mixed-density desktop is drawn at one density**, and **fractional scaling
  rounds up**: a client rendering at 2× downscaled is sharper than one rendering
  at 1× stretched, which is the deliberate choice rather than a bug.
- **A 3D transform or a `zoom` *above* a window is invisible to the SDK.**
  `defaultMeasure` walks the flat tree and reads each ancestor's computed style,
  but an ancestor's perspective does not reach the child's matrix, and `zoom`
  scales the box without being a transform — so the compositor is told two wrong
  things about one window, and an ancestor's `zoom` mispositions it as well.
- **A guest refuses everything an embedder is asked for.** A page in a browser
  window cannot open a second window, and permissions and dialogs route through
  `WebViewGuest`'s `WebContentsDelegate` and are answered by the default. A
  refusal is the answer that has a guard behind it; opening them is one piece of
  work each, and `CreateCustomWebContents` logs when one is refused.
- **A browser window's address bar cannot follow its page.** Where the guest
  actually went is the browser process's, `WebViewGuestClient` carries only
  `HistoryChanged(can_go_back, can_go_forward)`, and `src` is the author's
  attribute rather than a report — so a chrome can show where it *sent* a
  window and not where the page then went. `domicile-navigate` used to look
  like the answer and was not: the SDK synthesized it from Electron's
  `did-navigate` and it had fired for nothing since the fork landed, so it is
  deleted rather than left looking available.
- **Two things configure a client, and they disagree by a border.** The
  engine states an `<app>`'s box from `ReplacedContentRect` — the *content*
  box — and the chrome's `resize_app` reports `offsetWidth`/`offsetHeight`,
  the *border* box. A floating window is the only one with a border, so it is
  the only one where the two differ, and it gets two configures a layout
  change instead of one: the client redraws twice and settles on whichever
  landed last, up to the border's width from the hole it is drawn into.
  Harmless at 1px and the same seam that made the scale bug: the real answer
  is one source, which `report-app-sizes.ts` already says is the engine's.
- **A `wl_output` that is not a panel reports no physical size and no
  refresh** -- zero for both, which is what `wl_output` says a screen with no
  such number advertises. That is every described desktop and every nested one:
  a config's arithmetic and a host's window are not millimetres of glass, and
  neither has a mode. On a tty they are the panel's own, off the same
  `DisplaySnapshot` the CRTCs are configured from, and `DomicileDisplay`
  carries them. The one thing `display::Display` had no field for is the
  millimetres, so they cross it as the DPI they make with the mode and are
  divided back out in `components/domicile/browser/display_list.cc`; a
  connector that reports no size -- a projector, a virtual output -- still
  advertises zero, because zero is the reading.
- **A client that draws its own cursor into a surface gets a plain arrow.**
- **Hot-swapping the chrome page** is a page reload on the engine, and
  `announce_open_apps` is what makes one survivable. `scripts/dev-shell.sh` is
  the only thing that asks for one, on every rebuild; nothing a user runs does.

---

## Working here

### Run and test

```sh
nix develop                  # core shell: rust + node
cargo test                   # the pure-logic core
bun run turbo test           # TypeScript: lint, types, unit tests

nix develop .#full           # adds wayland, mesa, weston, kitty
./scripts/check.sh           # EVERYTHING: every test-*.sh, every e2e-*.sh,
                             # cargo, turbo. The whole answer before a push.
./scripts/check.sh e2e       # or one group: shell, rust, typescript, e2e
```

`check.sh` picks up any `scripts/test-*.sh` and `scripts/e2e-*.sh` by glob, so a
new check runs by existing. `smoke-compositor.sh` is outside that loop and is
run by hand. Everything here wants a checkout: the flake offers no app over any
of it, because `nix run` with no clone meant staging the store's read-only
source into a cache and building there, and nothing ever ran that.

Nothing in the suite needs a display.

```sh
# A desktop, on a machine that has a screen.
nix run 'github:cprussin/domicile#manganese'    # the reference shell
nix run 'github:cprussin/domicile' -- ./dist/shell.js   # a shell of your own
./scripts/dev-shell.sh manganese               # …and rebuilt as you edit
```

The engine job on `crux` is the only thing that builds the fork and drives the
pixel guards. It shares a checkout with whoever else is working there, so it
takes a lock first: `.github/scripts/engine-tree-lock.sh`, which is also what a
person on that machine runs before building by hand.

### Reading the compositor's frame report

One `INFO` line per window of frames:

```
composited fps commit_ms composite_ms composite_worst_ms
submit_ms submit_worst_ms idle_ms response_ms response_worst_ms chromes
```

- `composite_ms` — importing the client's buffer and drawing every layer, **up
  to but not including** the submit.
- `submit_ms` — the submit alone, which on a nested window blocks for a frame
  callback. Kept apart from `composite_ms` because a figure that includes the
  buffer swap is not comparable with one that does not.
- `response_ms` — the client's own redraw, which is the client's number rather
  than ours, and the control on the other two.
- `idle_ms` — how much of the window nothing happened in.

### Gotchas that will bite you

- **`nix develop` only sees git-tracked files.** A brand-new untracked file makes
  the flake error with "not tracked by Git" — `git add` it first. Staging is
  enough; a dirty tree only warns.
- **`nix run github:…?ref=<branch>` caches a branch for an hour.** A run right
  after a push re-runs the *old* revision, which reads exactly like "my fix did
  nothing". Pass `--refresh` whenever the branch is moving.
- **Unix socket paths are capped at ~108 characters.** Use a short
  `XDG_RUNTIME_DIR` like `/tmp/domicile-rt` for anything that binds one.
- **Which way up an output is drawn cannot be tested without a screen.** Reading
  a buffer back is consistent either way, so the offscreen tests pass under
  both. It was settled on hardware; do not "simplify" it.
- **A solid-color texture cannot test a texture matrix** — it looks the same
  however it is mapped. Fixtures are patterned for this reason: a y-inversion
  bug passed a solid-texture comparison unchanged.
- **A client's buffer may be upside down and the types do not say so.** A client
  that renders with GL sets `Y_INVERT`; Smithay records it and does not expose
  it, so it is carried from the import.
- **A global a client wants and does not find is not an error it reports.** A
  missing `wl_data_device_manager` showed up as the chrome freezing whenever a
  tab was dragged.
- **gpg signing fails in the agent container.** Commit with
  `git -c commit.gpgsign=false …`.

Smithay, specifically:

- **Keycodes need `+8`** (evdev → xkb) from the chrome, which sends evdev.
- **Flush clients** after dispatch *and* after off-thread input, or clients hang.
- **A `wl_output` global is required** or many clients never map a toplevel, and
  **`wl_surface.enter` must be sent** — a toolkit that scales its content asks
  which output it is on before drawing anything. GLFW, and so kitty, blocks on
  exactly that and maps a window that stays blank.
- **A v3 dmabuf global is not enough for Mesa**: the format list says what a
  client may allocate, never which GPU. That comes from v4 feedback's
  `main_device`.
- **Buffers must be released.** Smithay releases the *previous* buffer on the
  next commit — the one the client cannot draw into. The compositor takes it out
  of the surface state and releases it once the pixels are out.
- **Input from the chrome is injected on the Wayland thread** through a
  `calloop::channel`; seat and surfaces are not `Send`.

Clients, for testing:

- **kitty** is the GPU/dmabuf client, verified on an AMD iGPU. ~7s from mapping
  to first frame, and it sizes itself to the output unless configured.
- **A GPU client is slow between mapping and drawing.** Anything sampling "did a
  frame arrive" off the map reads zero and blames the compositor.
- **`weston-flower` commits twice and stops** — under real weston too. Not a
  compositor bug. `weston-simple-shm` animates and is the better shm client.
- **`wev` segfaults** here. **`weston-eventdemo` prints no pointer events**; use
  `WAYLAND_DEBUG=1`.
- **In a container there is only llvmpipe**, where no client can allocate a
  dmabuf, so `e2e-dmabuf.sh` stops after asserting the global.

---

## Repo layout

| Path | What | Build |
|---|---|---|
| `packages/domicile-config` | config schema, parse, validate, hot reload | core |
| `packages/domicile-scene` | transforms, hit-testing, pointer routing, z-order (pure math) | core |
| `packages/domicile-protocol` | host↔chrome wire messages, versioning | core |
| `packages/domicile-host` | the orchestrator brain and its IPC | core |
| `packages/domicile-launch` | `domicile` itself: which page, which platform, where the components are, and the supervisor that starts them | core |
| `packages/domicile-compositor` | **the running compositor**: Smithay server, imports, input, the engine seam | `.#full` |
| `packages/domicile-engine` | the Chromium fork: the patch series, the pin, the published engine | — |
| `packages/chrome-sdk` | the shell-facing API: elements, `DomicileClient`, measurement, input | bun |
| `packages/component-library` | shared React components, the Panda preset, `shellBuild` | bun |
| `packages/shell-manganese` | the reference desktop: tabs, stage, rail, address bar | bun |
| `packages/shell-simple` | the minimal desktop: floating windows | bun |
| `packages/domicile-test-client` | the stand-in Wayland client the checks open a window with | core |
| `packages/domicile-test-chrome` | the stand-in chrome the compositor's own tests drive | core |
| `packages/e2e-harness` | the headless chrome stand-in, and the check on the e2e machinery | bun |
| `packages/test-support` | shared bun test setup | bun |
| `scripts/` | `check.sh`, the e2e and smoke checks, `dev-shell.sh` | — |
| `.github/scripts/` | what the engine job runs: the tree lock, the reset, the build, the release | — |

Inside `domicile-compositor`: `screens.rs` is what the desktop is made of;
`dmabuf_import.rs` the import; `engine.rs`, `engine_session.rs` and
`engine_buffers.rs` the seam to the fork and what it holds; `outbound.rs` the
queue to the chrome; `scale.rs`, `viewport.rs`, `coalesce.rs`,
`timing_window.rs`, `modifiers.rs`, `latency.rs` are each one small thing named
after itself.

**Two rules the chrome queue is built around, both from freezes.** Never write
to a chrome from the Wayland loop — a chrome that reads slowly fills the socket
buffer and a blocking write stops frame callbacks for *every* client. Never
*wait* on one either: that stalls the thread that injects input, past the 200ms
repeat delay, so a key the user tapped starts repeating. `outbound.rs` is the
queue that keeps both, and `message()` never waits and never drops. It no
longer gives frames a policy of their own, because no frame comes down it: a
client's buffer goes to the display compositor, so what is left is messages.
The freeze itself is written down in `tests/input.rs`, where a chrome that
stopped draining once cost the compositor twenty seconds.

---

## Collaboration notes

Proceed autonomously and follow your own recommendations; stop only when
genuinely blocked on taste or hardware. Keep strict TDD. Commit freely, and open
a pull request for every change.

The standing lesson: **what runs here cannot see a screen**, and the second one,
learned the hard way — **a document that describes a deleted mechanism is worse
than no document**. This file said "there are two paths, and both work" for as
long as there was one.
