# Surface embedding: source map

Where the code that puts a compositor's surface into a page lives. Paths are
under `src/`. Design: [ENGINE-FORK.md](/docs/architecture/ENGINE-FORK.md).

## Frame sink broker

| File | Role |
|---|---|
| `components/domicile/mojom/frame_sink_broker.mojom` | the interface a non-renderer producer calls, plus `SurfaceObserver`, which tells it which surface an embedder chose |
| `components/domicile/mojom/external_surface.mojom` | the interface a page calls. One method, grant only. A renderer never gets a `FrameSinkBroker` pipe |
| `components/domicile/browser/frame_sink_broker.{h,cc}` | the broker. Takes its `HostFrameSinkManager` and `FrameSinkId` allocator from the embedder, so tests need no browser |
| `components/domicile/browser/brokered_frame_sink.{h,cc}` | one registered `FrameSinkId`; also code ported from `exo::Buffer` that turns a dmabuf into a `SharedImage` and `TransferableResource` |
| `components/domicile/browser/display_capture.{h,cc}` | one display capture: a viz `FrameSinkVideoCapturer` whose frames go to the producer |
| `components/domicile/browser/display_capture_target.{h,cc}` | which browser window's root frame sink shows a display |
| `components/domicile/browser/external_surface_provider.{h,cc}` | the renderer-facing wrapper over the broker; refuses a parent frame sink outside the calling renderer |
| `content/browser/domicile/domicile_frame_sink_broker.{h,cc}` | the browser's single broker and the socket a producer connects to |
| `third_party/blink/renderer/platform/graphics/external_surface_embedder.{h,cc}` | the page side: allocates the `LocalSurfaceId`, gets the `FrameSinkId`, pairs them |

- `browser_main_loop.cc` creates the broker at startup.
- The socket opens only when `--domicile-broker-socket` names a path.
- The browser holds a page's embed until a producer connects, so a page may
  embed an `<app>` before its client window exists.

## Engine library

| File | Role |
|---|---|
| `components/domicile/engine/domicile_engine.{h,cc}` | `libdomicile_engine.so`: the C ABI, the broker pipe and the pollable fd |
| `components/domicile/engine/engine_event_queue.{h,cc}` | queue from mojo's thread to the compositor's thread; an eventfd tells the compositor when to drain it |
| `components/domicile/engine/engine_smoke.c` | checks the C header compiles and the library works from C |
| `components/domicile/engine/engine_capture_probe.cc` | captures the browser's window through the C ABI and reads the frames back |
| `components/domicile/engine/engine_dmabuf_smoke.cc` | the same for a real dmabuf: allocate, import, submit twice, see the release |

## Spike code

Test-only. `spike.sh` runs it, and `guard-css-and-resize.sh` runs `spike.sh`.

| File | Role |
|---|---|
| `components/domicile/spike/surface_producer.{h,cc}` | a test producer standing in for the compositor |
| `components/domicile/spike/solid_color_submitter.cc` | the single-pixel color check at the window center |
| `components/domicile/spike/css_parity.cc`, `css_parity_layout.h` | the CSS parity and latency run, and its page geometry; must match `scripts/spike-css-page.html` |
| `components/domicile/spike/window_diff.{h,cc}` | turns a capture into the CSS parity pass/fail results; unit tested |
| `components/domicile/spike/spike_color.{h,cc}` | compares the drawn color with the submitted one |
| `components/domicile/spike/mojom/spike_probe.mojom`, `content/browser/domicile/domicile_spike_probe.{h,cc}` | the pixel probe: a `CopyOutputRequest` on the browser window |

## Tests

- Unit tests: `frame_sink_broker_unittest.cc` (the broker and its provider,
  against a real `HostFrameSinkManager`), `display_capture_unittest.cc` (against a fake viz
  capturer), `display_capture_target_unittest.cc`, `window_diff_unittest.cc`,
  `engine_event_queue_unittest.cc`.
- The Blink side and the probe have no unit tests. They need a display
  compositor. `spike.sh` and `guard-css-and-resize.sh` cover them.
