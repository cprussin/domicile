// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "cc/domicile/display_regions.h"

#include <algorithm>
#include <optional>

#include "ui/gfx/geometry/rect_conversions.h"
#include "ui/gfx/geometry/transform.h"

namespace cc {
namespace {

std::optional<gfx::Rect> InLayer(const gfx::Rect& in_target,
                                 const gfx::Transform& to_target) {
  if (!to_target.IsScaleOrTranslation()) {
    return std::nullopt;
  }
  return to_target.InverseMapRect(in_target);
}

// What is left of `from` once every one of `cut` is taken out of it, as
// rectangles apart.
std::vector<gfx::Rect> Without(const std::vector<gfx::Rect>& from,
                               const gfx::Rect& cut) {
  std::vector<gfx::Rect> left;
  for (const gfx::Rect& rect : from) {
    const gfx::Rect gone = gfx::IntersectRects(rect, cut);
    if (gone.IsEmpty()) {
      left.push_back(rect);
      continue;
    }
    // Above and below the cut across the whole width, then beside it.
    const gfx::Rect bands[] = {
        gfx::Rect(rect.x(), rect.y(), rect.width(), gone.y() - rect.y()),
        gfx::Rect(rect.x(), gone.bottom(), rect.width(),
                  rect.bottom() - gone.bottom()),
        gfx::Rect(rect.x(), gone.y(), gone.x() - rect.x(), gone.height()),
        gfx::Rect(gone.right(), gone.y(), rect.right() - gone.right(),
                  gone.height()),
    };
    for (const gfx::Rect& band : bands) {
      if (!band.IsEmpty()) {
        left.push_back(band);
      }
    }
  }
  return left;
}

}  // namespace

DomicileDisplayRegions DomicileDisplayRegionsOf(
    const std::vector<DomicileDisplay>& displays,
    const gfx::Point& widget_origin,
    float page_scale) {
  DomicileDisplayRegions regions;
  for (const DomicileDisplay& display : displays) {
    if (display.scale >= page_scale) {
      continue;
    }
    gfx::Rect in_widget = display.rect;
    in_widget.Offset(-widget_origin.OffsetFromOrigin());
    regions.push_back({gfx::ScaleToEnclosingRect(in_widget, page_scale),
                       display.scale / page_scale});
  }
  return regions;
}

std::vector<float> DomicileRatiosMeeting(const DomicileDisplayRegions& regions,
                                         const gfx::Rect& rect_in_target) {
  std::vector<float> ratios;
  for (const DomicileDisplayRegion& region : regions) {
    if (region.rect.Intersects(rect_in_target) &&
        !std::ranges::contains(ratios, region.ratio)) {
      ratios.push_back(region.ratio);
    }
  }
  std::ranges::sort(ratios);
  if (ratios.size() > kDomicileMostDisplayTilings) {
    ratios.resize(kDomicileMostDisplayTilings);
  }
  return ratios;
}

bool DomicileKeepsDisplayTilings(const DomicileLayer& layer) {
  return layer.to_page_is_scale_or_translation &&
         !layer.is_directly_composited_image;
}

bool DomicileDrawsFromDisplayTilings(const DomicileLayer& layer) {
  return layer.draws_into_page && DomicileKeepsDisplayTilings(layer);
}

gfx::Rect DomicileRegionInLayer(const DomicileDisplayRegions& regions,
                                float ratio,
                                const gfx::Transform& to_target) {
  gfx::Rect around;
  for (const DomicileDisplayRegion& region : regions) {
    if (region.ratio != ratio) {
      continue;
    }
    const std::optional<gfx::Rect> in_layer = InLayer(region.rect, to_target);
    if (!in_layer.has_value()) {
      return gfx::Rect();
    }
    around.Union(*in_layer);
  }
  return around;
}

std::vector<DomicileCoveragePiece> DomicileCoverage(
    const DomicileDisplayRegions& regions,
    const gfx::Transform& to_target,
    const gfx::Rect& visible) {
  std::vector<DomicileCoveragePiece> pieces;
  std::vector<gfx::Rect> rest = {visible};
  if (to_target.IsScaleOrTranslation()) {
    for (const DomicileDisplayRegion& region : regions) {
      const std::optional<gfx::Rect> in_layer = InLayer(region.rect, to_target);
      if (!in_layer.has_value()) {
        continue;
      }
      // What of the region is still unclaimed is the rest's overlap with it.
      for (const gfx::Rect& unclaimed : rest) {
        const gfx::Rect piece = gfx::IntersectRects(unclaimed, *in_layer);
        if (!piece.IsEmpty()) {
          pieces.push_back({piece, region.ratio});
        }
      }
      rest = Without(rest, *in_layer);
    }
  }
  for (const gfx::Rect& rect : rest) {
    pieces.push_back({rect, 1.f});
  }
  return pieces;
}

}  // namespace cc
