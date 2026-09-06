# Upstream bug report — ready to file, NOT filed

**Still unfiled.** issues.chromium.org needs a Google account; neither the
machine that found this nor the session that reviewed it has one, so filing it
is a person's job. It is kept here rather than on a build machine so it is not
lost, and so that whoever files it does not have to re-derive it.

Everything below is written to be pasted into https://issues.chromium.org
(component: Internals>Compositing).

Verified present on trunk `725aa8ea5082c`, fetched 2026-09-05.

---

**Title:** `SurfaceLayer::SetOverrideChildPaintFlags(bool)` ignores its argument
and always sets true

**Component:** Internals>Compositing
**Type:** Bug

## What happens

`cc/layers/surface_layer.cc:138`

```cpp
void SurfaceLayer::SetOverrideChildPaintFlags(bool override_child_paint_flags) {
  override_child_paint_flags_.Write(*this) = true;
}
```

The parameter is unused. The member is unconditionally set to `true`, so the
property can be turned on but never off, and passing `false` turns it on.

There is no `SetNeedsPushProperties()` either, unlike every neighbouring setter,
so a change does not schedule the push that would carry it to the impl side.

## Why it matters

Two callers, and one of them passes a runtime value:

- `components/viz/service/layers/layer_context_impl.cc:955`
  ```cpp
  layer.SetOverrideChildPaintFlags(extra->override_child_paint_flags);
  ```
  This deserialises the flag from a layer-context client. A client that sends
  `false` gets `true`. That is a silent protocol mismatch rather than a
  cosmetic one.
- `third_party/blink/renderer/platform/graphics/surface_layer_bridge.cc:143`
  passes a literal `true`, so it is unaffected — but it means any
  `cc::SurfaceLayer` built by `SurfaceLayerBridge` has the flag latched on for
  the layer's whole life, and no caller can undo it.

The impl-side counterpart is correct
(`cc/layers/surface_layer_impl.cc:128`), which handles its argument and
early-returns when unchanged — so the two halves of the same property disagree.

The flag is read at `cc/layers/surface_layer_impl.cc:225` to override the
embedded child surface's paint flags at draw time, so it is not inert.

## How it was found

Comparing how two call sites configure the same `cc::SurfaceLayer` — the
out-of-process `<iframe>` path (`child_frame_compositing_helper.cc:60`, which
sets neither `SetStretchContentToFillBounds` nor `SetOverrideChildPaintFlags`)
against `SurfaceLayerBridge::CreateSurfaceLayer` (which sets both) — and trying
to make the second match the first. `SetStretchContentToFillBounds(false)`
works; `SetOverrideChildPaintFlags(false)` silently does not.

## Suggested fix

Match `SetStretchContentToFillBounds` immediately above it in the same file:

```cpp
void SurfaceLayer::SetOverrideChildPaintFlags(bool override_child_paint_flags) {
  if (override_child_paint_flags_.Read(*this) == override_child_paint_flags) {
    return;
  }
  override_child_paint_flags_.Write(*this) = override_child_paint_flags;
  SetNeedsPushProperties();
}
```

Worth checking whether any existing caller depends on the current
always-true behaviour before landing — `layer_context_impl.cc` is the one that
would change behaviour, and arguably that change is the point.
