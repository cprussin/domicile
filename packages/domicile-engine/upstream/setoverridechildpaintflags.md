# Upstream bug: `SetOverrideChildPaintFlags` ignores its argument (unfiled)

Not filed: issues.chromium.org needs a Google account, so a person must file it.

- **Why we care:** every `<app>` gets a `cc::SurfaceLayer` from
  `SurfaceLayerBridge`, which sets this flag. The OOPIF path does not. This is
  the one layer setting where `<app>` cannot be made to match the OOPIF path
  from outside Chromium. See
  [ENGINE-FORK-CHROMIUM-NOTES.md](../../../docs/architecture/ENGINE-FORK-CHROMIUM-NOTES.md).
- **Impact here:** none measured. No result differs between the two paths
  today, so nothing waits on this fix.
- **Status:** verified on trunk `725aa8ea5082c` (2026-09-05). Re-read
  `cc/layers/surface_layer.cc` at trunk before filing.

The report below is ready to paste.

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

- The parameter is unused. Passing `false` sets the flag to `true`, so it can
  never be turned off.
- Unlike the neighboring setters, it does not call `SetNeedsPushProperties()`,
  so a change is not pushed to the impl side.
- The impl-side setter (`cc/layers/surface_layer_impl.cc:128`) is correct.

## Why it matters

The flag is read at `cc/layers/surface_layer_impl.cc:225` to override the
child surface's paint flags at draw time. Callers:

- `components/viz/service/layers/layer_context_impl.cc:955` passes a value
  deserialized from a layer-context client:
  ```cpp
  layer.SetOverrideChildPaintFlags(extra->override_child_paint_flags);
  ```
  A client that sends `false` gets `true`.
- `third_party/blink/renderer/platform/graphics/surface_layer_bridge.cc:143`
  passes `true`. Every layer `SurfaceLayerBridge` creates has the flag on for
  its lifetime, and no caller can clear it.

## How it was found

We tried to make `SurfaceLayerBridge::CreateSurfaceLayer` configure its layer
like the out-of-process iframe path (`child_frame_compositing_helper.cc:60`),
which sets neither `SetStretchContentToFillBounds` nor
`SetOverrideChildPaintFlags`. `SetStretchContentToFillBounds(false)` worked.
`SetOverrideChildPaintFlags(false)` had no effect.

## Suggested fix

Match `SetStretchContentToFillBounds` above it in the same file:

```cpp
void SurfaceLayer::SetOverrideChildPaintFlags(bool override_child_paint_flags) {
  if (override_child_paint_flags_.Read(*this) == override_child_paint_flags) {
    return;
  }
  override_child_paint_flags_.Write(*this) = override_child_paint_flags;
  SetNeedsPushProperties();
}
```

Check that no caller depends on the always-true behavior.
`layer_context_impl.cc` is the only caller whose behavior would change.
