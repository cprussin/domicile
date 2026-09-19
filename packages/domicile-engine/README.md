# domicile-engine

The Chromium fork, carried as a patch series rather than a fork of the tree.

`docs/architecture/ENGINE-FORK.md` is why this exists and what it is for; read
it first. In one line: `<app>` becomes a `cc::SurfaceLayer` embedding a viz
surface the compositor submits, so CSS applies to a window structurally instead
of being reimplemented in a shader.

## Why a series and not a fork

The compositing half is deliberately **additive** — a browser-side broker, a
mojo interface, `<app>` and `<webview>` as elements of their own — so most of
it is new files, and new files never conflict. The DRM half cannot be: an
ozone platform is edits to `ui/ozone/platform/drm` and `ui/events/ozone/evdev`,
and those are Chromium's. Carrying either as a 40 GB fork of `chromium/src`
would hide the only number that matters, which is how much of it *does*
conflict when Chromium moves. Here that number is countable: bump
`CHROMIUM_PIN`, run `apply.sh`, count what rejects — and *Moving the pin* below
is why that is a pull request rather than a session on the build host.

Electron and ungoogled-chromium carry their downstreams the same way, for the
same reason.

## Layout

| | |
|---|---|
| `CHROMIUM_PIN` | the exact revision the series applies to. One line |
| `src/` | new files, laid into the checkout as-is. The bulk of the fork |
| `patches/` | `git format-patch` output for edits to files Chromium already owns |
| `upstream/` | bugs found in Chromium itself, written to be filed and not yet filed. One today: `setoverridechildpaintflags.md`, which `HTMLAppElement`'s own `SurfaceLayerBridge` runs into — see `ENGINE-FORK.md`'s *Whether an `<app>` is an out-of-process `<iframe>`* |
| `scripts/apply.sh` | series → checkout |
| `scripts/extract.sh` | checkout → series. Run before every push |
| `scripts/build.sh` | `gn gen` + `autoninja` with the args the spike is measured under |
| `scripts/under-wayland.sh` | runs another script under a nested wlroots compositor on the GPU — the only platform that can import a dmabuf. Every guard below runs under it except the `guard-webview-*.sh` ones, which have no client to import from |
| `scripts/guard-client-window.sh` | a real Wayland client's window on the page, and the color it drew coming back out |
| `scripts/guard-two-windows.sh`, `guard-two-windows.html` | two clients, two windows, one page — two `SurfaceDrawQuad`s in one aggregation |
| `scripts/guard-shell.sh` | a real shell, built by its own vite config and joined by the SDK, with a client's window in it |
| `scripts/guard-webview-framing.sh`, `guard-webview-framing.js`, `guard-webview-framing-server.py` | a site that refuses framing, shown in a `<webview>`. The one guard here that runs headless and needs no compositor: what it measures is a page against itself, so there is no client and nothing to import |
| `scripts/guard-webview-history.sh`, `guard-webview-history.js`, `guard-webview-history-server.py` | the four history controls of a `<webview>`, driven at the guest behind it: two pages, then back, forward, reload and a stop, read as the order the guest showed them in — plus what the element says back and forward can do, and whether it says a page is still arriving, which the same schedule already builds a settled page and a pending one for. Headless too, and its control drives none of the four |
| `scripts/guard-webview-keyboard.sh`, `guard-webview-keyboard.js`, `guard-webview-keyboard-socket.py`, `guard-webview-keyboard-key.py` | a desktop chord pressed while a browser window holds the keyboard, caught in the guest's own delegate. Headless, like the framing guard above |
| `scripts/guard-webview-click.sh`, `guard-webview-click.js`, `guard-webview-click-mouse.py` | a click inside a browser window, and the event it must leave in the shell's document — which is how a shell knows to raise the window |
| `scripts/guard-webview-new-window.sh`, `guard-webview-new-window.js`, `guard-webview-new-window-server.py` | a link with `target="_blank"` clicked in a browser window, and the second window it has to produce: the event the element dispatches, the address on it, and the page that then loads in the second `<webview>` the shell opens — because an event is not a window. Its control is the other half of the same page, an ordinary link, which must ask for nothing. Headless, and the click goes in over the debugging port |
| `scripts/guard-webview-guest-page.py` | the page a browser window shows for the keyboard and click guards, saying what it was given |
| `scripts/guard_webview_devtools.py` | driving a key or a press at a running engine over the debugging port, which is the only keyboard and pointer `crux` has. Imported, which is why it is the one file here with underscores |
| `scripts/guard-css-and-resize.sh` | the measurement: seven CSS properties, the resize, and the latency |
| `scripts/guard-latency.sh` | keystroke to pixel with a real client — the whole of what a user waits for, read out of the compositor's own `latency` lines. Under `under-wayland.sh` |
| `scripts/guard-control-arrival.sh`, `guard-control-arrival.js`, `guard-control-arrival-compositor.py` | the hop from the compositor's socket into the page, measured off the `arrival` stamp every `ControlChannelClient` method carries, and the cursor keyword set read end to end |
| `scripts/lib-latency.sh` | what a latency run means, read out of a log. Sourced by `guard-latency.sh` and by `/scripts/test-latency-report.sh`, so the reading is exercised without starting a browser |
| `scripts/lib-annotate.sh` | how a guard says where it stopped, as a GitHub annotation rather than a line in a thousand-line job log |
| `scripts/spike.sh` | run one step of the spike end to end; the producer's exit code is the verdict. What `guard-css-and-resize.sh` runs twice |
| `scripts/spike-page.html` | steps 2 and 3's page: a `<canvas>` that embeds instead of drawing |
| `scripts/spike-css-page.html` | the CSS half's page — each property on an `<app>` and on a `<div>` beside it |
| `scripts/spike-resize-page.html` | the resize cell, which needs a page to itself |
| `scripts/spike-engine.sh` | phase 1's library, end to end, from a C process. Run by hand, not by CI |
| `scripts/spike-dmabuf.sh` | a real dmabuf, imported, submitted and released. By hand, always under `under-wayland.sh` |
| `scripts/spike-iframe.sh`, `spike-iframe-page.html`, `spike-iframe-inner.html` | an `<app>` against an out-of-process `<iframe>`, over HTTP so the iframe can be cross-site. By hand |

## Getting one without building it

Building the fork is a Chromium checkout and about four hours, which is not
what running a desktop should cost. So CI publishes a build and the flake
fetches it:

```sh
nix build .#engine
```

That pulls a few hundred megabytes into the store once, checks it against the
hash in `engine-release.nix`, and patches it to run — which is what makes it
work on NixOS, where a generic-linux Chromium cannot start at all.
`/scripts/update-engine-release.sh` moves that file to the newest release, so
**which engine a given revision runs is a commit you can read.**

`DOMICILE_ENGINE` points `domicile` at a different one — a checkout's
`out/Domicile`, say. It names the directory holding `chrome`.

## The control channel's protocol, and what of it is here

`window.domicile` is the shell's control channel, and `navigator.domicile` is
the same object under the name it was born with: `WindowDomicile::domicile`
forwards to `NavigatorDomicile`, which is the supplement that owns the one
`DomicileHost` a window gets, so the alias cannot become a second channel. The
wire protocol lives in the browser process rather than in the page, which is
what makes a malformed message unconstructable — and what makes adding one cost
an engine release rather than a TypeScript edit. That trade was made
deliberately; it is worth knowing which side of it you are on before asking for
a new message.

**Implemented — every member the fork keeps.** Outbound: `spawn`, `focus_app`,
`focus_chrome`, `close_app`, `resize_app`, `set_desktop_size`,
`set_device_pixel_ratio`, `grab_shortcut`, `key`, `pointer_motion`,
`pointer_leave`, `pointer_button`, `pointer_axis`. Inbound: `welcome`,
`app_appeared`, `app_titled`, `app_resized`, `app_closed`, `app_cursor`,
`shortcut`, `modifiers`, `focus_changed`, `focus_requested`, `displays`,
`keymap`.

`keymap` is the one inbound message that stops in the browser process. It
carries the keymap the compositor compiled from `input.keyboard`, in the text
`wl_keyboard.keymap` hands a client, and what wants it is this process's own
`KeyboardLayoutEngine` — which off ChromeOS nothing else ever gives one, so
without it every printable key decodes to `DomKey::UNIDENTIFIED` and a shell
is a page nobody can type into. `components/domicile/browser/keyboard_layout.h`
is the whole of why, and it is not relayed to the page: the compositor has
already resolved the modifiers against this keymap, so a document holding 40
kilobytes of xkb has nothing to do with it. Adding a message therefore costs
four places *or one*, depending on which side of the browser it stops on.

`grab_shortcut` is the one member that goes no further than the browser
process. It used to be relayed to the compositor, which held the claims and
took a matching press out of the stream before the focused client saw it. It
cannot: a browser window is a `<webview>` whose page is a guest, and the
compositor never sees one of its keys — the shell is what forwards keys, and a
guest's never reach the shell. So the browser holds the set and matches it in
`WebViewGuest::PreHandleKeyboardEvent`, and the press comes back up `shortcut`
from there. See `src/components/domicile/browser/shortcut_registry.h`.

`displays` reaches the page as an attribute — `window.domicile.displays` —
with a bare `displayschanged` event beside it, rather than as an event carrying
the desktop. The desktop is a fact and not a stream: a component that mounts
after the description has to be able to read it, and an event carrying the only
copy is gone once dispatched.

It is **null** until the compositor has described a desktop, and an empty array
for a desktop with no screens. Those are different answers and a shell renders
them differently — nothing at all is right for "there is no such screen" and
wrong for "wait" — which is why `domicile-protocol` carries the distinction
across the wire in the first place.

**Deliberately absent:** `place_portal`, `remove_portal`, `declare_bands`,
`render_band`, `claim_pointer`, `app_composited`. These are the bands and
copy-path protocol, which `docs/architecture/ENGINE-FORK.md` lists under what
the fork scraps: layout positions the layer now, and the page has stopped
reporting where its own boxes are. Implementing them here would make removing
a dying protocol cost a release build.

**The typed surface is not the wire, and the difference is deliberate.** The
compositor speaks JSON; a shell speaks JS values. Three places where the
translation is a choice rather than a mapping:

- Sizes are `double` the whole way across. The compositor's sizes are `f64`,
  so `800.0` reaches the browser with a decimal point and a JSON reader types
  it as a double. Reading it as an integer got nothing, and every window
  arrived at zero.
- Modifiers arrive as `altKey`/`ctrlKey`/`shiftKey`/`metaKey`, not as xkb's
  depressed/latched/locked masks. The compositor has already resolved those
  against the keymap, and a page holding a mask cannot read it without the
  keymap too.
- A shortcut is a `DomicileShortcut` — `{ keycode, altKey, ctrlKey, shiftKey,
  metaKey }` — in both directions, so `grabShortcut()` takes the same shape the
  `shortcut` event hands back. `keycode` rather than `key` because it is an
  evdev code and `KeyboardEvent.key` already means a string.

If you are adding a message, add it in four places — the mojom, the IDL, the
browser-side serializer, and the Blink method — and add it to the list above,
because the list is how the next person knows whether a gap is deliberate.

**Batch them.** A new inbound message means a new event type, and a new event
type means an entry in `event_type_names.json5`, which invalidates Blink's
generated bindings and costs most of a full rebuild — tens of minutes, not the
usual seconds. Nineteen members added together cost one of those. Nineteen
members added one at a time cost nineteen. This is the standing cost of the
protocol living in the browser process, and it is the reason to arrive with a
list rather than with one message at a time.

## The command socket, which is how the shell is replaced

`--domicile-command-socket` is a unix stream this engine binds and the
supervisor dials. One line of JSON in, one out, and the connection is over:

```
{"type":"load_shell","version":1,"root":"/x/dist","module":"shell.js"}
{"type":"loaded"}   |   {"type":"refused","why":"…"}
```

An engine given no such switch binds nothing and listens on nothing, which is
every engine until `domicile load-shell` starts one.

**It is not the control channel, and that is the layering rather than a second
transport for its own sake.** Which shell to serve is supervisor-to-engine
information — the supervisor already says it once at launch, as
`--domicile-shell-root` and `--domicile-shell-module`. Routing it through the
compositor instead would put a message on the host↔chrome contract that the
page neither sends nor reads, and would make the compositor carry mail it has
no stake in. `docs/architecture/THE-DOMICILE-BINARY.md` has the record.

**This contract carries a version and the other two do not**, which is
`DATA.md`'s rule and not an inconsistency: the supervisor and the engine are
separately published, so the two ends of this socket are routinely built from
different revisions. `PROTOCOL_VERSION` is pinned at 1 because nothing ships
the compositor and a chrome apart, and the supervisor's own `domicile.sock`
carries no number because both of its ends are one binary.

| | |
|---|---|
| `components/domicile/browser/command_protocol.{h,cc}` | the wire. A line in, a line out, the applying injected — which is what makes it unit tests rather than a browser |
| `chrome/browser/domicile/domicile_command_socket.{h,cc}` | the socket, and the shell's window. In `//chrome` because reloading the shell needs `GlobalBrowserCollection`, which belongs to `//chrome/browser/ui` |
| `components/domicile/browser/shell_source.{h,cc}` | which shell this process is serving. Seeded from the two switches, replaced by a `load_shell` |

### There is no dev reload, and this is where one goes

A desktop runs under `--app`, which drops the browser's own keyboard
shortcuts, so there is no reload in it: a one-character change to a shell
means killing the desktop and starting it again. `scripts/dev-shell.sh` says
so, and `scripts/test-dev-shell.sh` asserts that it hands the engine no
`DOMICILE_DEV_RELOAD` — the variable switches nothing on anywhere.

**The command socket above is what replaces it**, once the supervisor dials
it: a watch script running `domicile load-shell` after each build is the whole
of dev reload, and it lives outside the runtime rather than inside every
served document. Nothing in the document the fork writes should grow a poller
again.

## Working on it

This is built on a machine with a Chromium checkout — `crux`, at
`/build/chromium/src`. It cannot be built anywhere else in this project, and
**it cannot be built by this repo's CI**: a green check on a change to this
package means the scripts linted, not that the series still applies. Treat CI
here as spell-check, never as proof.

```sh
./scripts/apply.sh   /build/chromium/src     # lay the series down
./scripts/build.sh   /build/chromium/src     # gn gen + autoninja
# ... work in the checkout, commit there ...
./scripts/extract.sh /build/chromium/src     # write it back here
```

### The checkout is scratch, and you are not alone in it

The loop above is right when one person is on the box. It is a trap when two
are, and both of these have already happened rather than been imagined:

- **CI resets that tree.** `engine.yml` and `engine-release.yml` reset
  `/build/chromium/src` to the pin and lay the series over it. `engine.yml`
  fires on any push or pull request touching `packages/domicile-engine/**`
  *except* Markdown under it and `engine-release.nix` — prose cannot change
  what the build produces and the job never reads the repin, and the exclusions
  are asserted by `/scripts/test-engine-path-filter.sh`. `engine-release.yml`
  fires on an `engine-v*` tag or a dispatch. So most pushes to the fork take
  the tree, and uncommitted work in the checkout is taken without warning. Take
  the lock around builds:
  `.github/scripts/engine-tree-lock.sh take /build/chromium/src "<who>"`, and
  drop it with the same owner string when you are done.
- **A file in the checkout with no counterpart in `src/` wedges the next run.**
  The reset removes the series' own files by walking `src/`, so anything not
  mirrored there survives, and `apply.sh` then refuses the dirty tree. The
  failure lands on somebody else's unrelated PR.

So: **write in this repo, compile in the checkout.** New files go into `src/`
at their mirrored path in the same change that creates them; edits to files
Chromium owns become patches via `extract.sh`. Then a reset costs you a re-run
of `apply.sh` and nothing else, which is the whole reason the series exists.

### Moving the pin

**A repin is a commit to this repository and nothing else.** It used to be a
commit *and* a person on `crux`: all three engine workflows checked that the
pin was already in the shared checkout and stopped with "roll the checkout
forward by hand" when it was not, so the one-line change that starts a rebase
could not be made by anyone — or anything — that could only reach this repo.

Two scripts carry it now, both under the tree lock, in every engine workflow:

| | |
|---|---|
| `.github/scripts/engine-reset.sh` | fetches the revision when the checkout does not have it, by revision where the server allows it and wholesale where it does not, then resets onto it |
| `.github/scripts/engine-sync.sh` | `gclient sync` to that revision, which is the *other* half of a pin: everything `DEPS` names is still at the previous one until it runs, and a half-rolled tree does not build |

So: change the line, open a pull request, and the engine job tells you what
rejects. What is still yours is what was always yours — a patch that rejects is
resolved in the checkout and written back with `extract.sh`, and a new upstream
file has no counterpart in `src/` until you put one there.

**What the sync costs, and why it is not in front of every run.** The pin the
DEPS were last synced to is written beside the checkout, in
`/build/chromium/.domicile-synced-pin`; a run whose pin matches it does not
start `gclient` at all, which is one `cat` against an incremental build of
~1m on a machine with one job slot. The run that does pay for it is the repin —
and that run is rebuilding most of Chromium anyway, so the minutes of
`gclient` are not the number in it that matters.

**The first run after this shipped syncs once for nothing.** There is no stamp
on `crux` until a run writes one, and a sync at the pin the tree is already at
is a few minutes of `gclient` finding nothing to do. Seeding the file by hand
would be the manual step this exists to remove.

`build.sh`, `spike.sh` and `guard-css-and-resize.sh` all have to run inside
Chromium's own toolchain shell — a component build links against that shell's glibc and
will not start without it:

```sh
NIX_SHELL_RUN="$PWD/scripts/guard-css-and-resize.sh /build/chromium/src" \
  nix-shell /build/chromium/src/tools/nix/shell.nix
```

`apply.sh` ends in `git am`, so the checkout needs a committer identity or the
patches fail with `unable to auto-detect email address` — a fresh `fetch`
leaves none:

```sh
git -C /build/chromium/src config user.name  "..."
git -C /build/chromium/src config user.email "..."
```

`extract.sh` regenerates `patches/` from the commits on top of the pin. It
cannot tell a new source file from build output, so **new files are copied into
`src/` by hand** — that is the one manual step and it is deliberate.

**A patch is made against the series, never against the pin.** Patch 0011 lands
on a tree that already has 0001–0010 on it, so a hunk regenerated in a scratch
tree holding only the pinned file has the right content and the wrong context —
and `git apply --check` in that same scratch tree says it is fine. On the runner
it is not: `git am` fails with *patch does not apply*, after the tree lock, the
reset and the whole series ahead of it. `scripts/test-patch-series-chain.sh`
catches exactly that without a checkout, by chaining the `index <pre>..<post>`
blobs of every file two patches both touch, and it runs in `check.sh`.

The rule the whole arrangement exists to enforce: work that is only in the
checkout does not exist. Extract and push, or it is lost with the machine.

## Measured

From a cold, from-scratch build on `crux` — 16 cores, no remote execution, no
cache:

| | |
|---|---|
| wall clock | 4h 16m, 56,376 steps at 3.67/s |
| CPU | 3450m user against 256m wall — ~13.5× parallel |
| disk | 97 GB for `depot_tools`, the checkout and `out/Domicile` together |
| toolchain | Chromium's own `tools/nix/shell.nix`, unaided |

Incremental, against a tree already built at the pin:

| | |
|---|---|
| null build — ninja stats 56k targets, nothing to do | 6–7s |
| apply the whole series to a built tree, `autoninja chrome` | 65s |
| edit one of the series' own files → `chrome` | 13–14s |

Net of the floor that is ~1m to lay the series down — `gn` regen, the mojom
generation, three objects, and relinking `libcontent.so` and `chrome` — and ~6s
per subsequent edit. The rebase number is still missing: it needs
`CHROMIUM_PIN` rolled onto a later revision, and that has not happened — the
roll itself is now a pull request rather than an afternoon on the build host,
so the number is one repin away. See `ENGINE-FORK.md`'s *Build and CI cost*.

## State

The spike in `ENGINE-FORK.md` is finished and **phase 1 is done**: the C ABI
library, the brokered frame sink, the dmabuf import ported from `exo::Buffer`,
`released` → `wl_buffer.release`, and the compositor submitting a client's
buffer. Phase 2 has two boxes left — an shm→dmabuf upload, and the latency
measurement rebuilt in the compositor — and phase 3 is the DRM work below.
`ENGINE-FORK.md`'s *Plan* is the current list; this section is what the fork
knows about the machine it runs on.

### A desktop draws on a bare tty

Patches `0012` through `0024` are the DRM half, and they are why the series
edits as many of Chromium's own files as it does: everything before them was
additive, and an ozone platform cannot be.

**A screen lights.** Confirmed on hardware. What was missing the whole time was
DRM master: nothing in the fork ever asked the kernel for it, so the first
modeset got `EACCES` and the first `drmSetMaster` a desktop ever ran was the
one a console switch asked for. `DrmMaster::Add` takes master as a card
arrives (patch `0019`).

**Nothing has to be told it is on a tty.** `domicile-launch`'s `platform()`
reads `XDG_VTNR` and chooses `drm` on its own, after `WAYLAND_DISPLAY` and
`DISPLAY` so that a session with both a display and a VT stays a window inside
that session. `OZONE=drm` still forces it and is no longer something to set;
`packages/domicile-launch/src/platform.rs` is the order and the reasons.

**Input from the first frame is written, not measured.** A tty desktop drew
its first frame deaf: logind hands a device back with an `inactive` flag, the
device was parked on it, and the only thing that un-parks one is a
`PropertiesChanged` edge that a session already in front of the user never
gets. `src/ui/ozone/platform/drm/domicile/drm_logind_input.cc` asks logind
whether the session is active rather than believing the flag, and
`/scripts/test-input-comes-from-logind.sh` is the guard. **It has not been
confirmed on hardware.** Treat it as written, not as proven.

Three things that were assumed and are not true:

- **`crux` has a GPU** — a GTX 970 on the proprietary driver, and Chromium
  drives it. `--disable-gpu` everywhere was a missing `libEGL.so.1` on the
  toolchain shell's path, not the absence of hardware. `GPU=1` on any of the
  spike scripts turns it on, and `scripts/e2e-dmabuf.sh` **passes** here rather
  than skipping.
- **On the GPU, an `<app>` is bit-exact against an ordinary element for every
  property, `transform` included.** Step 4's one imperfect cell was software
  rasterization. An out-of-process `<iframe>` is the thing that is *not*
  pixel-identical to a `<div>`.
- **A dmabuf can be imported on this machine**, under
  `scripts/under-wayland.sh` — `--ozone-platform=wayland` nested in a headless
  wlroots compositor. NVIDIA ships its own GBM backend and its EGL imports
  dmabufs, so Chromium's GBM path does not assume Mesa. Weston's headless
  backend cannot be used for it: it advertises no `zwp_linux_dmabuf_v1`.

Two things about how a frame gets there:

- **The producer submits its own frames.** The browser imports the dmabuf and
  hands back a `gpu::ExportedSharedImage` — a mailbox and a verified sync token
  — and the producer builds its own `TransferableResource` and submits straight
  to viz. Viz accepts a resource whose `SharedImage` another client created, and
  returns it through the producer's own sink. The per-buffer hop stays, the
  per-frame hop is gone, and no GPU channel moves.
- **A dmabuf now reaches the page.** `scripts/spike-dmabuf.sh` allocates two
  buffers on the render node, imports them through the C ABI, submits one and
  then the other, and `released` fires for the first — `wl_buffer.release`, the
  first time it has. The producer never sees a mailbox: the browser does the
  import and builds the frame, which is why the `exo::Buffer` port lives in
  `components/domicile/browser/`.

Two things that shape the assertion, both measured. **On this GPU a buffer is
CPU-writable or sampleable, never both** — NVIDIA's gbm refuses
`rendering|linear`, and a linear buffer imports without error then draws as the
fallback. So the harness allocates a renderable one it cannot fill, and asserts
the pixel is the buffer's own zeroed content rather than the fallback.
`LINEAR=1` runs it the other way and fails, which is what documents the limit.
And **it takes two frames to see a release**, because viz holds whatever is on
screen — which is exactly why a Wayland client double-buffers.

`under-wayland.sh` suits checks that do not have to find the page by scanning
for a full-width row of its background color, which is how the pixel checks
locate the viewport: under Wayland the browser window carries client-side
decorations and a shadow, so no row qualifies. The pixel checks stay on
`--ozone-platform=headless`, where the window is undecorated.

### The spike

All four steps, none killed: a
process the browser did not launch gets a frame sink from the browser's own
namespace, a `<canvas>` in an ordinary web page embeds the surface it submits
to, and CSS treats that canvas the way it treats any other element.

**Step 4 is the one that matters.** `guard-css-and-resize.sh` lays each property out
twice — once on an `<app>` and once on an ordinary `<div>` beside it — and
compares the two halves pixel for pixel out of the display compositor's own
draw:

```
$ ... scripts/guard-css-and-resize.sh /build/chromium/src
property             pixels   differ   interior    worst in effect  verdict
baseline              53200        0          0        1        no  pass
z-index               53200        0          0        0       yes  pass
transform             53200      285          0       84       yes  pass (edges only)
border-radius         53200        0          0        1       yes  pass
opacity               53200        0          0        2       yes  pass
filter: blur()        53200        0          0        1       yes  pass
mix-blend-mode        53200        0          0        1       yes  pass
negative control      53200    10800       9976      255        no  pass (differs, as it must)
```

**That run is `--disable-gpu`, and `transform`'s 285 pixels are the software
rasterizer rather than the mechanism.** `GPU=1 scripts/guard-css-and-resize.sh` on this
machine's card puts every cell at 0, `transform` included — which is the number
that describes what a user has. `z-index` is exact either way, and it is the
property bands failed at and the reason the fork exists.

`in effect` is the check that stops a property that never reached the page from
passing as parity, and the last row is the check that stops a diff that cannot
see a difference from passing at all.

Steps 2 and 3 are still `spike.sh`, and still a single pixel:

```
$ ... scripts/spike.sh /build/chromium/src -- --color=FF00C853
brokered frame sink: FrameSinkId(0, 2)
waiting for a page to embed it...
a page embedded us: LocalSurfaceId(1, 1, E8F6...) at 1024x681
BeginFrames are flowing
aggregated: drew #FF00C853, submitted #FF00C853
```

Kept:

| | |
|---|---|
| `components/domicile/mojom/frame_sink_broker.mojom` | the interface a non-renderer producer calls, plus `SurfaceObserver`, which is how it hears which surface an embedder chose for it |
| `components/domicile/mojom/external_surface.mojom` | the interface a *page* calls, which is one method wide and can only grant. A renderer never gets a `FrameSinkBroker` pipe |
| `components/domicile/browser/frame_sink_broker.{h,cc}` | the service. Takes its `HostFrameSinkManager` and its `FrameSinkId` allocator from the embedder, so it needs no `//content` and no browser to test |
| `components/domicile/browser/brokered_frame_sink.{h,cc}` | one registered `FrameSinkId`, held for as long as the producer submits to it |
| `components/domicile/browser/external_surface_provider.{h,cc}` | the renderer-facing shim over the broker |
| `components/domicile/browser/frame_sink_broker_unittest.cc` | the broker's own tests, against a real `HostFrameSinkManager` and an in-process `FrameSinkManagerImpl` |
| `components/domicile/spike/window_diff_unittest.cc` | the rule step 4's verdicts come out of: what counts as a difference, and what counts as an edge rather than a region |
| `components/domicile/engine/engine_event_queue_unittest.cc` | the fd the compositor polls: that an idle queue does not wake it, that a burst arrives whole, and that a push racing a drain is not lost |
| `content/browser/domicile/domicile_frame_sink_broker.{h,cc}` | the browser process's one instance, wired to `content::GetHostFrameSinkManager()` and `content::AllocateFrameSinkId()`, and the named socket a producer reaches it over |
| `third_party/blink/renderer/platform/graphics/external_surface_embedder.{h,cc}` | the page's half: allocates the `LocalSurfaceId`, asks the browser for the `FrameSinkId`, pairs them |

Phase 1's library, which is not throwaway — it is the seam:

| | |
|---|---|
| `components/domicile/engine/domicile_engine.{h,cc}` | `libdomicile_engine.so`. The C ABI, the invitation, the broker pipe, and the pollable fd. The header is C, and `engine_smoke.c` is the compiler checking that |
| `components/domicile/engine/engine_event_queue.{h,cc}` | mojo's thread pushes, the compositor's thread drains, an eventfd in between |
| `components/domicile/engine/engine_smoke.c` | what the library has to be able to do, asserted from C. Throwaway |
| `components/domicile/engine/engine_dmabuf_smoke.cc` | the same for a real dmabuf: allocate on the render node, import, submit twice, see the release. Throwaway |
| `components/domicile/browser/brokered_frame_sink.{h,cc}` | the `exo::Buffer` port. A dmabuf becomes a `SharedImage` and a `TransferableResource` here, in the browser, because that is where `aura::Env` is |

**Throwaway**, and deleted when `domicile-compositor` submits real buffers:

| | |
|---|---|
| `components/domicile/spike/surface_producer.{h,cc}` | the external producer. C++, in-tree, and that is a measured choice — see `ENGINE-FORK.md`'s *Rust: the bindings exist, the crate is not the seam* |
| `components/domicile/spike/solid_color_submitter.cc` | steps 2 and 3's assertion over it: one pixel at the center of the window |
| `components/domicile/spike/css_parity.cc`, `css_parity_layout.h` | step 4's. The latency loop and the page's geometry, which has to stay in step with `scripts/spike-css-page.html` |
| `components/domicile/spike/window_diff.{h,cc}` | the rule that turns a picture of the window into step 4's verdicts. Separate from the process that takes the picture because every "pass" in the measurement is this code's opinion, and it is unit tested |
| `components/domicile/spike/spike_color.{h,cc}` | comparing what viz drew with what was submitted, which every step ends in |
| `components/domicile/spike/mojom/spike_probe.mojom`, `content/browser/domicile/domicile_spike_probe.{h,cc}` | the pixel probe. A `CopyOutputRequest` on the browser's window, because the embedding layer belongs to the page now and there is no other way to keep the proof a pixel |
| `scripts/spike-page.html`, `spike-css-page.html`, `spike-resize-page.html` | the pages |

The broker is built at browser startup, from one line in
`browser_main_loop.cc`; its socket and the probe come with it only when
`--domicile-broker-socket` names a path, and a browser given none builds an
object that binds nothing and listens on nothing. A shell's page cannot embed
until a window exists and no window exists
until the compositor has connected over that socket, so opening it on a page's
first `embedExternalSurface()` was a deadlock. The browser still holds an
embed until a producer connects — an `<app>` element exists before the client
window behind it does — which is what makes it safe for a page to ask early.

The series edits files Chromium owns in `patches/`; everything else is new
files under `src/`. What that costs is the number to watch, and it is countable
rather than remembered:

```sh
grep -h '^diff --git' patches/*.patch | awk '{print $3}' | sed 's|^a/||' | sort -u | wc -l
```

`ENGINE-FORK.md`'s *Minimize edited files, not added ones* is the decision and
what the largest groups are for. The number has grown with the DRM work —
patches 0012 onward are mostly `ui/ozone/platform/drm` and `ui/events/ozone/evdev`,
which are files Chromium owns and which no additive design could have avoided.

The series' unit tests live in two targets. `components_unittests` holds
everything under `components/domicile/`, and `ozone_unittests` holds the DRM
platform's, which had nowhere else to run:

```sh
autoninja -C out/Domicile components_unittests ozone_unittests
./out/Domicile/components_unittests --gtest_filter='FrameSinkBrokerTest.*:…'
./out/Domicile/ozone_unittests --gtest_filter='DrmScreenTest.*:…'
```

**`.github/workflows/engine.yml` carries the two filters in full, and it is the
list to copy from rather than this one** — a filter matching nothing exits 0,
so a suite that stopped linking is a silent pass, and that job counts the
matched tests against a floor for exactly that reason. A new suite goes in the
filter and in the floor in the same change.

Neither the Blink half nor the probe has a unit test. Chromium does not unit
test `SurfaceLayerBridge` either — there is no `surface_layer_bridge_test.cc` —
and for the same reason: the seam only means anything with a display
compositor behind it. `spike.sh` and `guard-css-and-resize.sh` are what cover them, and
their exit codes are the assertion.
