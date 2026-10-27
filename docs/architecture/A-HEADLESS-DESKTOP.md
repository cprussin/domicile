# A headless desktop

`OZONE=headless` runs a full desktop with no display device, seat or VT.
Its monitors are virtual ones the shell or `domicile monitor` adds and
resizes. Frames leave through display capture (the ScreenCast portal), and
input comes in through EIS. This is for machines like WSL2, which has no KMS
device and no logind seat.

## Design

```
 domicile monitor / shell ──virtual_monitor, resize──▶ compositor ──virtual displays──▶ engine (ozone headless)
                                                         ▲                                │ one desk page,
 ScreenCast portal ◀── PipeWire ◀── display capture ─────┼────────────────────────────────┤ a presenter per monitor
 EIS client ──────────────────────────▶ EIS server ──────┴── domicile_input_inject ──────▶ HeadlessDeskInput ──▶ desk host
```

- **Monitors.** With `--domicile-headless-desk`, `OzonePlatformHeadless`
  takes the compositor's virtual displays (`SetDomicileVirtualDisplays`) and
  keeps `HeadlessScreen`'s list to match: added, updated in place, removed.
  With none, it reports one 1024x768 placeholder on `HEADLESS-1`, as
  `DrmScreen` does with nothing plugged in.
- **The desk.** Headless drives its own displays, as drm does, so
  `ShellWindows`, `DomicileDisplayWatcher`, the display layout and the desk
  host all run there (see [ONE-PAGE-FOR-THE-DESK.md](ONE-PAGE-FOR-THE-DESK.md)).
  Headless answers `presents_every_window = false`, so popups and tooltips
  are drawn inside their window and show in captures.
- **Windows in memory.** Headless imports no dmabufs, so the engine always
  composites on the CPU and the compositor hands it windows in shared memory
  ([A-DESKTOP-ON-A-TTY.md](A-DESKTOP-ON-A-TTY.md#software-output)). It
  advertises no dmabuf, so GL clients draw in memory too.
- **Resizing.** A virtual monitor keeps its id and connector when resized, so
  its `wl_output`, its windows and any capture of it stay. A capture follows
  the new size (`domicile_display_capture_resize`).
- **Input.** On headless the launcher passes the compositor
  `--engine-takes-input yes`, and EIS events go to the engine
  (`domicile_input_inject`) instead of the seat. `HeadlessDeskInput` makes
  each one the event a real device's would and hands it to the shell's
  window, so the shell sees keys first and clicks on the shell reach it.
  - Points are desktop coordinates; a headless desk is at scale 1.
  - Keys go through xkb with the compositor's keymap.
  - No key repeat. A touch is the left button, one finger at a time.
  - drm and nested keep the seat path. On drm the engine has a real seat too,
    so moving EIS there is a follow-up.
- **`domicile monitor <name> <width>x<height>`** adds a monitor, prints its
  output name, resizes it for each `<width>x<height>` line on stdin and
  removes it when it exits.

## Key decisions

- **Headless in Domicile over nesting in a host compositor.** Nested, Domicile
  is one window, so panes would be regions of one monitor, not monitors.
- **Ozone headless over drm with no card.** drm needs a card, logind and a
  seat at every step. Headless needs none, so it runs in CI and in the cloud
  container.
- **EIS through the engine over a second input path into the page.** The
  injected events reach the desk host the way evdev's do, so focus, shortcuts
  and pointer crossing come for free.
- **EIS reaches the lock screen.** On headless, EIS is the only keyboard, so
  a locked desk must take it. The shell's window gets it like a real hand's,
  and passes on what is over an app as it does a real hand's, which the lock
  still refuses.

## Plan

### 1. A desk on headless

- [x] launcher: on headless, `--disable-gpu` and `--software-compositing yes`
- [x] engine: headless counts as driving its displays (`ShellWindows`,
  `DomicileDisplayWatcher`)
- [x] engine: `OzonePlatformHeadless` virtual displays, connectors, display
  layout and `presents_every_window = false` (patch `0152`)
- [x] guard: a headless engine with two virtual monitors, each capture showing
  its slice of the desk (`guard-headless-desk.sh`)
- [x] compositor: no `zwp_linux_dmabuf_v1` with `--software-compositing`, so
  GL clients draw in memory

### 2. Resize in place

- [ ] protocol and SDK: a virtual monitor's lease takes `resize`
- [ ] compositor: `ClientRequest::ResizeVirtualMonitor`, same id and output
- [ ] engine: headless updates the display; drm replaces its snapshot
- [ ] `domicile monitor`

### 3. EIS reaches the shell

- [x] engine: `domicile_input_inject`; headless gets `HeadlessDeskInput` to
  the desk host and the xkb layout engine (patch `0153`)
- [x] compositor and launcher: on headless, EIS goes to the engine
  (`--engine-takes-input yes`)
- [x] guard: a click and a key injected on a headless desk reach the shell
  (`guard-headless-desk.sh`)
- [ ] drm: EIS through the engine too

## Open questions

- **Presenting into supplied buffers.** Recommend: measure frame-to-capture
  latency on headless first, and build it only if capture adds more than a
  frame.
