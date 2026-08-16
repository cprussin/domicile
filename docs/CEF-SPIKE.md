# The AppTextureBridge spike (runbook)

This is the one load-bearing risk in Loom: getting a live Wayland client's GPU
surface to render **inside the web page** as an `<app>` element with full CSS
(rounded, blurred, rotated). It needs a prebuilt CEF (Chromium) distribution and
a **GPU + display**, so it runs on your hardware, not in CI. Everything it plugs
into is already built and tested:

- `wc-bridge::BridgeRegistry` — maps each app to a stable `ExternalImageId` and
  its latest `DmabufDescriptor` (tested).
- `wc-compositor` — the Wayland server that will export each client's dmabuf.
- `wc-host` — assigns the app id and routes input to app-local coordinates (tested).
- `chrome-sdk` `<loom-app>` — reports the element's screen transform (tested).

## Goal / success criteria

Launch one Wayland client (e.g. `weston-terminal`) and see it appear inside the
chrome as an element that is simultaneously **rounded, drop-shadowed, blurred at
the edges, and rotated a few degrees**, updating live — and clicking inside it
lands in the app at the correct transformed coordinate. That proves an app
window is a first-class CSS element.

## Steps

1. **Fetch prebuilt CEF** (no Chromium build — minutes, not hours):
   - Download the Linux64 "Minimal" distribution from
     `https://cef-builds.spotifycdn.com/` (reachable from this machine) into
     `vendor/cef/` (already gitignored).
   - Add the `cef` Rust crate as an optional dep behind `wc-bridge`'s `cef`
     feature; point it at the extracted distribution.

2. **Off-screen render the chrome** with CEF OSR:
   - Enable `windowless_rendering_enabled`; load the resolved shell package's
     `index.html` (from `wc-config`).
   - Use `OnAcceleratedPaint` (GPU path) to get the page as a shared texture /
     dmabuf on Linux — validate this path early; it's CEF's rougher edge.

3. **Bridge app surfaces into the page** (the crux). Try least-invasive first:
   - **A — media source:** expose each app surface as a video frame source the
     page consumes via a `<video>` inside `<loom-app>`. `<video>` already
     composites external GPU frames with full CSS. No engine patch.
   - **B — WebGPU external texture:** import the app dmabuf as a
     `GPUExternalTexture` and draw it into a canvas inside `<loom-app>`. Needs a
     small privileged bind exposed to the page.
   - Keep `BridgeRegistry` as the source of truth: `register(app_id)` on
     `Host::app_appeared`, `update_frame` per client commit, `remove` on close.

4. **Present**: scan out CEF's composited frame via the compositor
   (nested `winit` window first; DRM/KMS later).

5. **Input round-trip**: feed libinput events to `Host::route_pointer`; for an
   `App { app_id, local }` result, forward to that client at `local`; otherwise
   deliver to the page. `wc-scene` already inverts the element transform, so a
   click on the *rotated* window maps to the right app pixel.

## Why this is a layer, not a fork

We never patch Chromium's compositor. Steps 3A/3B reuse pathways Chromium
already exposes for external GPU textures (`<video>`/WebGPU). If a zero-copy
privileged bind is wanted later, it's ~a file of glue against CEF's API — not a
fork of the engine.

## Fallbacks

- If `OnAcceleratedPaint` is unreliable on the target GPU, fall back to CEF's
  CPU `OnPaint` for the *chrome* (slow but unblocks everything else) while
  keeping app surfaces zero-copy.
- If neither 3A nor 3B is workable without engine changes, the minimal targeted
  shim (expose "bind dmabuf → texture" to a privileged origin) is the escape
  hatch — still far short of forking.
