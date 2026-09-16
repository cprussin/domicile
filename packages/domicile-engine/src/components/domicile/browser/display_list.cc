// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/display_list.h"

#include <vector>

#include "base/numerics/safe_conversions.h"
#include "ui/display/types/display_constants.h"
#include "ui/gfx/geometry/size.h"

namespace domicile {
namespace {

// What wl_output counts a refresh rate in, per Hz.
constexpr float kMillihertzPerHertz = 1000.f;

// The panel behind a display's density, in millimeters.
//
// The inverse of what drm_screen.cc does with the snapshot's own physical
// size, down to the same display::kInchInMm, which is what makes the pair
// exact rather than merely close. Per axis because the density is: a panel is
// not obliged to have square pixels, and one number for both would bring one
// of the two millimeter figures back wrong.
//
// Pixels rather than bounds(), which is DIP. They are the same on the platform
// this runs on -- nothing there sets a scale factor -- and a density is per
// PIXEL wherever that stops being true.
//
// Zero density is display::Display's own "nobody said", which is what a
// projector or a virtual output leaves it at, and an empty size is what
// wl_output says the same thing with -- so the unknown crosses as the unknown
// rather than as a mode divided by nothing.
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
  // Not named `display`: that is the namespace this loop's own type is in, and
  // shadowing it makes the next line anyone adds here mean something else.
  for (const display::Display& screen : displays) {
    list.push_back(mojom::Display::New(
        screen.id(), screen.bounds(), PhysicalSizeMm(screen),
        base::ClampRound(screen.display_frequency() * kMillihertzPerHertz)));
  }
  return list;
}

}  // namespace domicile
