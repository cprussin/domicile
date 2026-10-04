# Compositor Debugging

How to read the compositor's debug logs, plus known Smithay and test-client
pitfalls. For running and testing, see [DEVELOPING.md](DEVELOPING.md).

## Frame report

The compositor logs one `DEBUG` line (`frames`) per window of frames. The
launcher's default `RUST_LOG` hides it. Show it with
`RUST_LOG=info,domicile_compositor=debug`.

```
composited fps commit_ms composite_ms composite_worst_ms
submit_ms submit_worst_ms idle_ms response_ms response_worst_ms chromes
```

- **`composite_ms`:** importing the client's buffer and drawing every layer.
  Excludes the submit.
- **`submit_ms`:** the submit alone. On a nested window it blocks for a frame
  callback, so it is excluded from `composite_ms` to keep that number
  comparable.
- **`response_ms`:** the client's own redraw time. Use it as a control for the
  other two.
- **`idle_ms`:** time in the window with no activity.

Container numbers come from a software rasterizer; see `AGENTS.md`,
*Checking your work*.

## Slow app launch

Each app the shell starts logs three `DEBUG` lines, in order:

```
spawning client pid=1234 command=["kitty"] wayland_display="wayland-2"
app client connected pid=Some(1234)
toplevel mapped -> Host::app_appeared app_id=app-1
```

- **spawn → connected:** the app's own startup (linking, caches, fontconfig,
  GL driver). The compositor is not involved.
- **connected → mapped:** the Wayland exchange. A slow compositor shows up
  here.
- Match lines by pid. Repeated launches can arrive out of order.
- A slow first launch with fast later ones means a cold machine (page cache,
  fontconfig, Mesa shader cache). The time shows up in spawn → connected.

## Rendering pitfalls

- **Output orientation cannot be tested without a screen.** Offscreen
  readback passes either way. The current orientation was verified on
  hardware; do not change it without a screen to check.
- **A solid-color texture cannot test a texture matrix.** Test fixtures use
  patterns so a y-inversion bug fails.
- **A client buffer may be upside down.** GL clients set `Y_INVERT`. Smithay
  records it but does not expose it, so the compositor carries it from the
  import.
- **Clients do not report missing globals.** A missing
  `wl_data_device_manager` made the chrome freeze when a tab was dragged.
- **Honor every advertised global.** Example: `wp_viewporter` must apply the
  destination size. Ignoring it draws surfaces at 2x and offsets portal and
  pointer coordinates above 1x scale. Headless tests run at 1x and miss it.

## Smithay

- **Keycodes need `+8`.** The chrome sends evdev codes; xkb expects evdev + 8.
- **Flush clients** after dispatch and after off-thread input, or clients hang.
- **Advertise a `wl_output` global and send `wl_surface.enter`.** Without them
  many clients never map, or map blank. GLFW (and so kitty) waits for
  `wl_surface.enter` before drawing.
- **Mesa needs dmabuf v4 feedback.** The v3 format list does not say which GPU
  to use. v4 feedback's `main_device` does.
- **Release buffers.** Smithay releases the previous buffer on the next commit.
  The compositor takes the current buffer out of the surface state and
  releases it after drawing.
- **Inject chrome input on the Wayland thread** through a `calloop::channel`.
  The seat and surfaces are not `Send`.

## Test clients

- **kitty** is the GPU/dmabuf test client, verified on an AMD iGPU. It takes
  about 7s from mapping to first frame, so a check for a frame right after
  mapping sees nothing. It sizes itself to the output unless configured.
- **`weston-flower` commits twice and stops**, under weston as well, so it is
  not a compositor bug. Use `weston-simple-shm` as the shm client; it animates.
- **`wev` segfaults.** **`weston-eventdemo` prints no pointer events.** Use
  `WAYLAND_DEBUG=1` instead.
- **Containers only have llvmpipe**, which cannot allocate a dmabuf.
  `e2e-dmabuf.sh` asserts the global and then skips.
