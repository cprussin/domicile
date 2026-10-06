// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_SPIKE_SPIKE_COLOR_H_
#define COMPONENTS_DOMICILE_SPIKE_SPIKE_COLOR_H_

#include <string>

#include "third_party/skia/include/core/SkColor.h"

namespace base {
class CommandLine;
}

namespace domicile::spike {

// Spike only: compares the colors viz drew with the colors submitted.

// Per-channel tolerance. SkiaRenderer may convert through the display's color
// space, so the drawn color can differ from the submitted one in the low bits.
inline constexpr int kChannelTolerance = 4;

// True if every channel of `a` is within `tolerance` of `b`'s.
bool ColorsMatch(SkColor a, SkColor b, int tolerance = kChannelTolerance);

// The largest per-channel difference between `a` and `b`, alpha included.
int ChannelDistance(SkColor a, SkColor b);

// "#AARRGGBB".
std::string ToHex(SkColor color);

// `switch_name` as AARRGGBB hex, or `fallback` if it is absent or unparseable.
SkColor ParseColor(const base::CommandLine& command_line,
                   const char* switch_name,
                   SkColor fallback);

}  // namespace domicile::spike

#endif  // COMPONENTS_DOMICILE_SPIKE_SPIKE_COLOR_H_
