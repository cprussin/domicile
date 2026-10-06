// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/display_list.h"

#include <vector>

#include "base/numerics/safe_conversions.h"
#include "ui/display/types/display_constants.h"
#include "ui/gfx/geometry/size.h"

namespace domicile {
namespace {

// wl_output reports refresh rates in mHz.
constexpr float kMillihertzPerHertz = 1000.f;

// Recovers a display's physical size in millimeters from its density.
//
// Inverts drm_screen.cc with the same display::kInchInMm so the result is
// exact. Computed per axis because pixels need not be square. Uses pixels, not
// bounds(), because density is per pixel. Zero density means unknown and maps
// to an empty size, which wl_output also reads as unknown.
gfx::Size PhysicalSizeMm(const display::Display& screen) {
  const float horizontal = screen.GetPixelsPerInchX();
  const float vertical = screen.GetPixelsPerInchY();
  if (horizontal <= 0.f || vertical <= 0.f) {
    return gfx::Size();
  }
  const gfx::Size pixels = screen.GetSizeInPixel();
  return gfx::Size(
      base::ClampRound(display::kInchInMm * pixels.width() / horizontal),
      base::ClampRound(display::kInchInMm * pixels.height() / vertical));
}

}  // namespace

std::vector<mojom::DisplayPtr> DisplayListFor(
    const std::vector<display::Display>& displays) {
  std::vector<mojom::DisplayPtr> list;
  list.reserve(displays.size());
  // Not named `display`, which would shadow the namespace.
  for (const display::Display& screen : displays) {
    list.push_back(mojom::Display::New(
        screen.id(), screen.bounds(), PhysicalSizeMm(screen), screen.label(),
        base::ClampRound(screen.display_frequency() * kMillihertzPerHertz)));
  }
  return list;
}

}  // namespace domicile
