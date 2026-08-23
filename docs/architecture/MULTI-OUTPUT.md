# Multi-output

The desktop is a list of displays in the config, one `wl_output` each, and one
chrome page spanning all of them. A display is a *region of the page*, and the
shell puts things on one with `<Screen name="left">`.

## Problem

Domicile had one output, of a hardcoded size; the scene has a single
`surface_to_output`; and there is nowhere for a shell to ask how many screens
there are — so a shell cannot put a panel on one monitor and a launcher on
another, which is the first thing a shell wants to do.

A nested compositor has no monitors to enumerate and no DRM to ask, so the
layout comes from the config until there is a DRM backend.

## Design

`[[output.displays]]` (#74) describes each display: `name`, `position`, `size`,
`scale`. Everything below is in **logical** units — the CSS pixels the chrome
lays out in and the coordinates `wl_pointer` speaks.

### One coordinate space, with its origin at the top-left

The config's positions are wherever the user wrote them, negative included. The
desktop's space is those normalised so the bounding box's top-left corner is
`(0, 0)`, because everything downstream assumes it: `compose::logical_to_window`
is a pure scale with no translate, the chrome layer is pinned at the origin,
and `getBoundingClientRect` is viewport-relative. A display at `[-1920, 0]`
beside one at `[0, 0]` is a 3840-wide desktop whose displays are at `0` and
`1920`.

`DisplayInfo.position` and `xdg_output.logical_position` are in the normalised
space. The config's numbers never leave `domicile-config`.

**Gaps are legal.** #74 rejects overlap, not a hole — real desktops have them,
and rejecting them would reject the layout that motivates this. The page spans
the hole, the shell paints it as it likes, and no `wl_output` covers it: a
pointer there is over no display, which is the chrome's, which is what it
already is today.

### The shell's API

```tsx
const displays = useDisplays();

<Screen name="left"><Dock /></Screen>
<Screen match={(d) => d.size[0] > 2000}><Wallpaper /></Screen>
<Screen everywhere><Clock /></Screen>
```

`<Screen>` absolutely-positions its children over the display's rectangle. It
renders once per matching display, so `everywhere` and `match` can produce
several and a `name` that matches nothing renders nothing — a display that is
not plugged in should cost the shell an empty region, not an error. `name`,
`match` and `everywhere` are mutually exclusive.

`everywhere` rather than `all`, which is what this said first: Panda's
extractor reads JSX props on capitalised tags as style props, and `all` is a
real CSS property, so `<Screen all>` emitted `all: true` into the shell's
stylesheet and failed the CSS minifier.

That is the whole per-display API. One page means one `BridgeClient` and one
copy of the shell's state, so moving a window between displays is changing
where its `<domicile-app>` is laid out.

**Where it lives.** `@domicile/chrome-sdk` is framework-agnostic — no React, no
`.tsx` — so it gets the data only: `BridgeClient.displays`, retained rather
than merely delivered, because the hold answers the *first* handler to
register for a type and then forgets — right for a stream, wrong for a fact.
Latest wins, for the reason below. `useDisplays` and `<Screen>` are React, so
they go in `@domicile/component-library` with the rest of the chrome's
components, and `useDisplays` reads a `DisplayProvider` mounted **once**: `on`
is a single slot, so a hook that registered per component would unregister
every one before it. The provider reaches the bridge through a `DisplaySource`
port — the retained `displays`, plus an `onDisplays` returning its teardown —
so the component library keeps no protocol dependency, and the shell writes the
few lines that adapt one to the other.

```rust
HostMessage::Displays { displays: Vec<DisplayInfo> }

struct DisplayInfo {
    name: String,
    /// Top-left corner and size, logical, in normalised desktop coordinates.
    position: [i32; 2],
    size: [u32; 2],
    scale: u32,
}
```

`PROTOCOL_VERSION` goes to 12 for the message and 14 for the guarantee that it
is always sent; `negotiate` is exact-match, so an old chrome is refused rather
than left to infer a desktop. `ChromeMessage` is unchanged.

**Ordering is the SDK's, not the socket's.** `Displays` is written on the
connection thread with `Welcome`, but that does not order it against
`announce_open_apps`, which reaches the same writer from the Wayland thread —
`AppAppeared` can already precede `Welcome` today. `BridgeClient` holds
messages by type until a handler is registered, which is the existing mechanism
for exactly this — `hello` precedes every `on()` on every startup already — and
it also retains the last `displays`, so anything that asks later gets it
without a handler at all.

**The desktop is re-described when it changes**, which on the configured path
it never does and on the no-displays path it does whenever the window is
resized or its density changes — the desktop *is* Domicile's own window.
`set_output` therefore does both — updates the retained answer, so the next
chrome to connect is told the current desktop, and broadcasts, so the pages
already connected are not left laying out against one that is gone. Two
mechanisms because they fail separately — and neither is distinguishable by the
chrome that asked for the change, which a broadcast reaches and which a message
sent only to it would have reached too. Telling the two apart takes a chrome
that was connected and did not ask.

Only the density half is driveable headlessly — a resize needs a window — so
that is the half the e2e pins, and the resize half rides on the same
`set_output`.

That broadcast goes out on the writer thread while the handshake answer is
written by the connection thread, so the two can interleave on a socket that
connected in the same instant as a change. Only one order is a problem — the
new `displays` written first and the answer's own copy after it — and
latest-wins is exactly what makes it one: on a desktop nobody resizes again,
nothing later corrects it.

What keeps a stale `displays` from being last in the ordinary case is *not*
the writer lock, which a broadcast is serialised before taking. (`freshened`'s
docstring argues this too, and deliberately: two copies, because this doc is
where the subsystem is read from and a bare pointer would not survive it being
read on its own. Whoever changes one should change both, and this file goes
away when its plan completes.) It is that
`set_output` describes and then broadcasts that same desktop, on one thread,
into a queue one writer drains in order — so every stale line has a newer one
queued behind it. The handshake answer is the exception, written by another
thread with nothing queued behind it, so it reads the desktop as it writes
rather than carrying the copy it was built with. That leaves *describe without
broadcast* as the way to break this, and there is exactly one: the startup
describe, safe only because no socket thread exists yet.

The other order needs nothing: a broadcast reaching a connection registered at
accept but not yet welcomed is followed by the handshake answer, which carries
the desktop as of when it is written.

### Which output a surface is on

`new_toplevel` enters every output unconditionally. Which one it *should* be:

| The surface | Enters |
|---|---|
| has a portal | every output its portal's bounding box intersects — all of them if that set is empty, which a portal in a gap or off the desktop's edge is |
| has no portal — never mounted, backgrounded, a popup | **all** of them |
| is the chrome | all of them |

The fallback is the load-bearing half. A toolkit that scales asks which output
it is on and blocks until told, and "none" is not an answer — ROADMAP records
GLFW, and so kitty, mapping a blank window without it. And a portal is not a
reliable signal of existence: `AppWindow` renders a backgrounded tab
`hidden`, which places it invisibly, which is a `scene.remove` — so keying
membership on "has a portal" alone would have every backgrounded window leave
every output.

Pointer routing is unchanged: `Scene::route_pointer` takes one desktop point
against one scene, and it still does.

### What each display's `scale` costs

It governs the `wl_output` it advertises, and so what clients on it draw at.

The chrome is one page at one `devicePixelRatio`, and that number is the
engine's over the outputs its toplevel entered — every one of them, per the
table above, which for Chromium means **the maximum**. Naming it matters
because it is what each cost below is measured against:

- **The chrome itself.** At DPR 2 it rasterises a *bounding-box-sized* page at
  2x — four times the pixels for the whole desktop, including the regions that
  are 1x. On the dev backend that is then scaled down into a window several
  times smaller. This is the largest of the three.
- **Copy path.** A client on a 2x display ships four times the pixels through
  the readback and the socket. At DPR 1 — the headless path every check
  runs — the page then draws them into a 1x canvas and downsamples: four times
  the per-frame cost for no sharpness. At DPR 2 they are shown sharply and only
  the first cost applies.
- **Native path.** The compositor composites at the window's scale, so the
  extra pixels are discarded there too until the DRM backend exists.

The all-outputs fallback widens this rather than containing it: a surface with
no portal enters every output, so a scaling toolkit picks the maximum scale —
an unplaced or backgrounded client on the *1x* display draws at 2x as well, and
each foreground/background transition can change the entered set and force a
redraw at a new scale.

On a same-density desktop — every display at the same `scale` — none of this
applies. On a mixed one it is the price of a single page, and the alternative
is in Key Decisions below.

`SetDevicePixelRatio` / `ClientRequest::SetOutputScale` / `output.max_scale`
carry no output identity and stay the no-displays path.

### The nested window

`compositor.nested_size` is the fallback when no displays are configured,
replacing the hardcoded size — shipped. Sizing the window itself to the
displays' bounding box is not; see the plan item below.

`WinitEvent::Resized` calls `adopt_window_scale`, which sets the desktop *from
the window* — right where nothing described one, since then the window is the
desktop. With displays configured the desktop is fixed and the window shows it
scaled.
`logical_to_window` scales the axes independently, so a host that will not give
a window the desktop's aspect ratio stretches it. Left as is: a dev backend
that shows a two-display desktop distorted is still driveable, and letterboxing
is a change to that function rather than to this design.

Per-monitor scanout is the DRM backend's job (ROADMAP phase 3). It clips one
desktop-sized composite per output, which is what the spanning page already
implies.

## Key decisions

**Config over discovery.** Hooks for a runtime configuration app come later; a
static description is what makes the rest of this testable now.

**One page spanning the desktop, not one window per display.** The rejected
alternative is worth stating, because it looks like the obvious one.

A chrome window is two connections — a host-protocol connection the preload
opens per renderer, and a Wayland client, which is the whole Electron process
with N toplevels on it. Nothing correlates them: `ClientState::is_chrome` is
per-client, and `chrome_toplevel: Option<ToplevelSurface>` holds one. Every
mechanism for naming a toplevel's display fails or costs:

| Mechanism | Why not |
|---|---|
| `xdg_toplevel` title | `packages/shell-manganese/index.html` sets `<title>`, which overrides `BrowserWindow`'s, so every window claims the same name — and `new_toplevel` fires before `set_title`, after `output.enter` and `focus_chrome()` have already run |
| `app_id` | process-wide in Electron |
| A chrome Wayland socket per display | works, and costs N Electron processes |

Beyond naming, N pages means N copies of the shell's state — `useShellWindows`
holds the window list in React state, and each display would have its own,
disagreeing. It also needs portal ownership per app (with an answer for the
owner disconnecting, which strands its apps), unicast frames, a send-to-one
path on `Outbound`, display identity on `ClientRequest`, and `Shortcut`
delivered to the grabbing connection rather than fired N times.

What it buys is the mixed-DPI cost above. `<Screen>` is the seam: a shell
written against it compiles unchanged if this is revisited, so the decision is
reversible without touching shell code.

**Static display list.** The compositor does a single `Config::load` at startup
and has no `ConfigStore`. Hot-reloading the list means creating and destroying
`wl_output` globals, re-`enter`ing every client and resizing the window; it is
its own change.

## Plan

- [x] `[[output.displays]]` in `domicile-config` (#74)
- [x] `domicile-protocol` + `@domicile/chrome-sdk/protocol`:
      `HostMessage::Displays`, `DisplayInfo`, `PROTOCOL_VERSION` 12, decoded
      onto `BridgeClient` (#76)
- [x] `domicile-compositor`: normalise the configured layout to a
      top-left-origin desktop; one `Output` per display, positioned; the
      bounding box as the desktop; `adopt_window_scale` no longer redefining
      the desktop; `compositor.nested_size` as the no-displays fallback; and
      `DisplayConfig::position`'s doc comment saying it is the *config's*
      space (#77, #82)
- [x] `domicile-compositor`: `self.output` becomes the set of them, across the
      call sites that assume one (#82)
- [ ] `domicile-compositor`: `wl_surface.enter` / `leave` per the table above,
      including the all-outputs fallback for a surface with no portal; and
      `winit::init()` given window attributes sized to the desktop — it is
      called with none, so a described desktop is shown at winit's default
      size, and `Screens::size` is already the geometry to pass. The e2e for
      it is the criterion the two-display script was written with and could
      not assert against the all-outputs interim: a client placed on *each*
      display, asserting each entered its own output and neither entered the
      other
- [x] `domicile-host`: the display list on the responses side, so
      `apply_chrome_message` can answer `Hello` with `Displays` — `ChromeHub`
      already carries `max_scale` / `wayland_display` / `presenting` for the
      same reason (#84)
- [x] `domicile-compositor`: describe the desktop to the host at startup and
      from `set_output` thereafter, per "The desktop is re-described when it
      changes" above. `Advertised::described` is the retyping, `as_measure`
      the assertion that a size or a scale is never negative (#84)
- [x] `@domicile/component-library`: `useDisplays` and `<Screen>`. A provider
      rather than `useDisplays(bridge)` per component — `on` is a single slot,
      so a hook that registered per component would unregister every one
      before it. It reaches the `BridgeClient` through a `DisplaySource` port
      — the retained `displays` plus an `onDisplays` registration — rather
      than a dependency on `@domicile/chrome-sdk`: the shell writes the four
      lines that adapt one to the other, and the library keeps knowing nothing
      about the protocol
- [x] `packages/shell-manganese`: put the rail and the clock on named screens;
      size the Electron window from the desktop, which is cross-process — the
      desktop size arrives on the renderer's bridge and the window is the main
      process's, so it goes over a channel pair of its own; and stop the page
      scrolling, since a document wider than its viewport offsets every
      `getBoundingClientRect` and puts every portal somewhere else with no
      symptom
- [x] `scripts/e2e-two-displays.sh`: two configured displays, asserting a real
      Wayland client is told both — names, positions, scales and modes — and
      that its own surface enters both rather than only the first, which the
      globals cannot answer and no unit test reaches (#82). The criterion this
      item was written with is stated on the `wl_surface.enter` item above,
      since it cannot be asserted until that rule exists (#82)
- [x] `scripts/e2e-displays-on-hello.sh`: the same two displays, asserting a
      real chrome is told them over a real socket at the handshake, positions
      and scales intact (#84). The other half of the same config: one script
      is what the Wayland side advertises, this one is what the page lays out
      against, and neither implies the other
- [x] `scripts/e2e-desktop-changed.sh`: the *other* config, where the desktop
      is Domicile's own window and so changes at runtime — three chromes, one
      per way of being told, per the same section (#84)
- [ ] delete this doc and its AGENTS.md index row; drop "One scene output"
      from ROADMAP's known gaps and multi-output from phase 3, leaving
      per-monitor scanout there

## Open questions

**`scale: u32` against a `devicePixelRatio` that is `f64`.** Integer matches
`wl_output`, which is what the field feeds. Recommendation: keep it integer and
revisit with `wp_fractional_scale_v1`, which ROADMAP already records as
separate work.

**"Intersects" for a rotated portal.** A window turned 30° has an axis-aligned
bounding box larger than itself, so it would enter an output it does not touch.
Recommendation: use the bounding box and accept the over-report — entering an
extra output costs a client a `scale` event, where missing one costs it a
frame.
