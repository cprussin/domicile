# Protocols Chromium asks for

Wayland protocol definitions that are not in `wayland-protocols` and not in
Smithay: Chromium's own, defined by `exo`, the ChromeOS compositor. They are
vendored because there is nowhere to depend on them from — they live in the
Chromium tree, under the MIT licence reproduced in each file's `<copyright>`.

Chromium asks for these before it will send its layer tree as a subsurface per
quad, and says so in its own log rather than failing:

    Server doesn't support zcr_alpha_compositing_v1.
    Server doesn't support overlay_prioritizer.

Both are *hints*. Nothing in either sends an event back to the client, and a
compositor is free to take the hint or ignore it — which is why implementing
them is small. See `docs/architecture/WINDOW-COMPOSITING.md`.

| file | interfaces | from |
|---|---|---|
| `overlay-prioritizer.xml` | `overlay_prioritizer`, `overlay_prioritized_surface` | `components/exo/wayland/protocol/` |
| `alpha-compositing-unstable-v1.xml` | `zcr_alpha_compositing_v1`, `zcr_blending_v1` | `third_party/wayland-protocols/unstable/alpha-compositing/` |
