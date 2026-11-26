// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_COMMON_DEVICE_DETAILS_H_
#define COMPONENTS_DOMICILE_COMMON_DEVICE_DETAILS_H_

#include <cstdint>

#include "base/containers/span.h"

namespace domicile {

// How a page that hides the device's details sees them: each a little off
// from the truth, the same way for the whole of a site's visit, as Brave's
// farbling does, so a script that reads them can't tell this browser from
// the next. `seed` is the page's site's for the session (the browser's
// DeviceDetailsHiding). See docs/architecture/AD-BLOCKING.md.
//
// Blink calls these where a page reads the details; nothing here knows of
// pages.

// `navigator.hardwareConcurrency`: between 2 and `real`, or `real` when that
// is 2 or fewer.
unsigned FarbledHardwareConcurrency(uint64_t seed, unsigned real);

// What audio a page renders or analyzes is multiplied by: within a
// hundred-thousandth of 1, and never 1.
float FarbledAudioFactor(uint64_t seed);

// Flips the lowest bit of one color channel of a few of `pixels`' visible
// pixels, 4 bytes each with alpha last (RGBA or BGRA), by the seed and the
// pixels themselves: the same pixels come back the same. Leaves pixels with
// nothing visible, and fewer than one pixel, alone.
void FarblePixels(uint64_t seed, base::span<uint8_t> pixels);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_COMMON_DEVICE_DETAILS_H_
