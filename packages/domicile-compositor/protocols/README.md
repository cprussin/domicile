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
| `surface-augmenter.xml` | `surface_augmenter`, `augmented_surface`, `augmented_sub_surface` | `components/exo/wayland/protocol/` |
| `alpha-compositing-unstable-v1.xml` | `zcr_alpha_compositing_v1`, `zcr_blending_v1` | `third_party/wayland-protocols/unstable/alpha-compositing/` |

## The augmenter is different, and is an experiment

`surface-augmenter.xml` is not here because Chromium asked for it. It never
does — it is not in any `Server doesn't support` line — and it is here because
it is the last difference between this compositor and `exo`, the one server
known to make the engine send a quad per composited layer.

It is advertised only under `--experiment-augmenter`, which defaults off, and
**none of it is implemented**: every request is logged and nothing is honoured.
That is defensible only because the flag cannot be reached by a desktop and
because the log is the result being collected. Advertising a protocol without
honouring it is what broke every display denser than 1x once already.

Measured, and the reason this stays an experiment rather than becoming work:
with the augmenter advertised, **the engine does not bind it.** A client binds
the globals it wants when it enumerates the registry, before it renders, so
that is not a decision deferred until a GPU exists. The engine is not looking
for an augmenter, and does not gate delegation on finding a compositor shaped
like `exo`.
