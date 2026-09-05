// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_SPIKE_SPIKE_COLOR_H_
#define COMPONENTS_DOMICILE_SPIKE_SPIKE_COLOR_H_

#include <string>

#include "third_party/skia/include/core/SkColor.h"

namespace base {
class CommandLine;
}

namespace domicile::spike {

// THROWAWAY, with the rest of the spike. Comparing what viz drew against what
// was submitted, which every step of the spike ends in.

// Per-channel with slack: the display's colour space is not necessarily the one
// the quad was authored in, and SkiaRenderer may round through it. An exact
// match is not the claim; "the colour we submitted, not the page's background"
// is.
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
