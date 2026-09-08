// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/core/html/domicile/layout_app_surface.h"

#include "third_party/blink/renderer/core/html/domicile/html_app_element.h"
#include "third_party/blink/renderer/core/paint/paint_info.h"
#include "third_party/blink/renderer/platform/graphics/paint/foreign_layer_display_item.h"

namespace blink {

LayoutAppSurface::LayoutAppSurface(HTMLAppElement* element)
    : LayoutReplaced(element) {}

void LayoutAppSurface::UpdateAfterLayout() {
  NOT_DESTROYED();
  LayoutReplaced::UpdateAfterLayout();

  // The box the client is configured at. Pixel-snapped, because that is the
  // size the layer is given below and a producer rendering at a different size
  // from the quad it lands in is the one way this seam can scale a window.
  //
  // The element ignores a size it is already at, so this runs on every layout
  // and resizes the client on the ones that moved it.
  if (auto* app = DynamicTo<HTMLAppElement>(GetNode())) {
    app->SurfaceBoxChanged(
        ToPixelSnappedRect(ReplacedContentRect()).size());
  }
}

void LayoutAppSurface::PaintReplaced(const PaintInfo& paint_info,
                                     const PhysicalOffset& paint_offset) const {
  NOT_DESTROYED();
  auto* app = DynamicTo<HTMLAppElement>(GetNode());
  if (!app) {
    return;
  }
  cc::Layer* layer = app->ContentsCcLayer();
  if (!layer || paint_info.ShouldOmitCompositingInfo()) {
    // Nothing to draw and nothing to draw it with. An <app> whose producer has
    // not connected paints as its background does -- which is the page's, and
    // is what makes a window that is not there yet look like a gap rather than
    // like a hole.
    return;
  }

  PhysicalRect paint_rect = ReplacedContentRect();
  paint_rect.Move(paint_offset);
  gfx::Rect pixel_snapped_rect = ToPixelSnappedRect(paint_rect);

  layer->SetBounds(pixel_snapped_rect.size());
  layer->SetIsDrawable(true);
  // Hit testing stays this page's: Domicile routes input itself and knows which
  // client owns the pointer, so the layer is hit-testable for the page's sake
  // and viz is not asked to arbitrate.
  layer->SetHitTestable(true);

  // This is the whole of the CSS-parity claim. RecordForeignLayer puts the
  // window in the page's own property trees, so transform, clip, opacity,
  // filter and blend are applied to it by the page's compositor exactly as they
  // are to any other layer.
  RecordForeignLayer(paint_info.context, *this,
                     DisplayItem::kForeignLayerAppSurface, layer,
                     pixel_snapped_rect.origin());
}

}  // namespace blink
