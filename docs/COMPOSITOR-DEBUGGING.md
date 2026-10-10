# Compositor Debugging

How to read the compositor's debug logs, plus known Smithay and test-client
pitfalls. For running and testing, see [DEVELOPING.md](DEVELOPING.md).

## Frame report

The compositor logs one `DEBUG` line (`frames`) every 5 seconds in which a
client committed a buffer. The launcher's default `RUST_LOG` hides it. Show it
with `RUST_LOG=info,domicile_compositor=debug`.

```
commits commit_ms idle_ms response_ms response_worst_ms chromes
```

- **`commit_ms`:** handling one commit end to end, including handing its buffer
  to the engine.
- **`idle_ms`:** the gap between one commit finishing and the next arriving.
  Large means waiting on clients.
- **`response_ms`:** keystroke to the client's next commit. Subtract it from
  the chrome's `rt_ms` for the time a key takes to reach the client.

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

## Window, monitor and region casts

`DOMICILE_CAST_WINDOW=<title>` casts the first window that takes that title to
PipeWire, without the ScreenCast portal. Use it to check the producer
(`src/casting/`) with any PipeWire consumer.

```sh
DOMICILE_CAST_WINDOW=kitty domicile …
pw-link domicile-cast:capture_1 <consumer>:input_1   # without a session manager
```

`DOMICILE_CAST_MONITOR=<output>` casts a monitor by its `wl_output` name, and
`DOMICILE_CAST_MONITOR=<x>,<y>,<width>x<height>` a region of the desktop in
logical pixels. Both need an engine with display capture; a nested desktop's
one monitor is its window. Without an engine, `DOMICILE_CAST_TEST_PATTERN=1`
fills monitor and region casts with one color instead
(`scripts/e2e-a-monitor-casts-through-the-portal.sh` uses it).

- `cast ready … node=N`: the stream's node. A consumer connects to it.
- `cast format … settled=…`: what the consumer picked: `Shm`, `Dmabuf`, or a
  modifier the producer fixed.
- `cast ended … why=…`: `ConsumerLeft` when the last link goes,
  `SourceGone` when the window closes.
- A stream offers dmabufs only when the compositor has an EGL renderer and
  libgbm; otherwise shm only.
- The pointer is the built-in arrow. The engine draws the desk's pointer from
  its theme, so the compositor has no image of it.

`scripts/e2e-a-window-casts-to-pipewire.sh` runs this against its own
`pipewire` daemon.

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
