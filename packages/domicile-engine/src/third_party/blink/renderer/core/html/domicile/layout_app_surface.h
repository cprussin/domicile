// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_LAYOUT_APP_SURFACE_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_LAYOUT_APP_SURFACE_H_

#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/layout/layout_replaced.h"

namespace blink {

class HTMLAppElement;

// The layout box of an <app>.
//
// A replaced element, like <canvas> and <video>: the window has a box the page
// lays out, and content the page does not draw. Its two jobs are to tell the
// element what size that box became -- which is the configure the client is
// resized by -- and to record the element's cc::SurfaceLayer as a foreign
// layer, which is what puts the window in this page's property trees.
class CORE_EXPORT LayoutAppSurface final : public LayoutReplaced {
 public:
  explicit LayoutAppSurface(HTMLAppElement*);

  const char* GetName() const override {
    NOT_DESTROYED();
    return "LayoutAppSurface";
  }

 private:
  void UpdateAfterLayout() override;
  PhysicalNaturalSizingInfo GetNaturalDimensions() const override;
  void PaintReplaced(const PaintInfo&,
                     const PhysicalOffset& paint_offset) const override;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_LAYOUT_APP_SURFACE_H_
