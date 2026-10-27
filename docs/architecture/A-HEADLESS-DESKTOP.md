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
 EIS client ──────────────────────────▶ EIS server ──────┴── domicile_input_inject ──────▶ SystemInputInjector ──▶ desk host
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
- **Input.** When the engine owns input (drm, headless), EIS events go to the
  engine's `SystemInputInjector` instead of straight to the window under the
  point. They then take the path a real keyboard and pointer take: the shell
  sees keys first and clicks on the shell reach it. Nested runs keep today's
  path, since the host owns input there.
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
  injector reaches the desk host the way evdev does, so focus, shortcuts and
  pointer crossing come for free on drm too.

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

- [ ] engine: `domicile_input_inject` to `SystemInputInjector`; headless gets
  an injector to the desk host and the xkb layout engine
- [ ] compositor: EIS goes to the engine on drm and headless
- [ ] e2e: an EIS click on the shell and a shell shortcut from EIS keys

## Open questions

- **EIS on a locked desk.** Today the lock refuses all emulated input. On
  headless, EIS is the only keyboard, so a locked desk could never unlock.
  Recommend: EIS reaches the lock screen like a real keyboard; app windows
  still get nothing while locked.
- **Presenting into supplied buffers.** Recommend: measure frame-to-capture
  latency on headless first, and build it only if capture adds more than a
  frame.
