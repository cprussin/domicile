// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_COMMON_DISPLAY_TRANSFORM_H_
#define COMPONENTS_DOMICILE_COMMON_DISPLAY_TRANSFORM_H_

#include <optional>
#include <string_view>

#include "base/notreached.h"

// A monitor's rotation and its wire-name codec.
//
// The four `wl_output.transform` rotations. Must match
// `domicile_protocol::DisplayTransform`, `domicile_config::Transform` and
// `displayTransformSchema` in `@domicile-desktop/sdk`.
//
// Each name is the counterclockwise turn the content takes to appear upright,
// per the `wl_output` convention: `rotate-90` is for an output rotated 90
// degrees clockwise. A page applies it as written.
//
// One x-macro list drives both directions so they cannot disagree. Callers
// fall back to `kNormal` on an unknown name, because dropping the whole
// desktop description would leave the shell with no screens.

// The closed set. Order matches `mojom::DisplayTransform` and
// `domicile_protocol::DisplayTransform`.
#define DOMICILE_DISPLAY_TRANSFORMS(X) \
  X(kNormal, "normal")                 \
  X(kRotate90, "rotate-90")            \
  X(kRotate180, "rotate-180")          \
  X(kRotate270, "rotate-270")

namespace domicile {

// Parses a wire name, or returns nullopt if it is unknown.
template <typename DisplayTransformEnum>
inline std::optional<DisplayTransformEnum> DisplayTransformFromWire(
    std::string_view name) {
#define DOMICILE_DISPLAY_TRANSFORM_FROM_WIRE(transform, wire) \
  if (name == wire) {                                         \
    return DisplayTransformEnum::transform;                   \
  }
  DOMICILE_DISPLAY_TRANSFORMS(DOMICILE_DISPLAY_TRANSFORM_FROM_WIRE)
#undef DOMICILE_DISPLAY_TRANSFORM_FROM_WIRE
  return std::nullopt;
}

// The wire name of a rotation. Every enum value is in the list; the unit test
// checks that.
template <typename DisplayTransformEnum>
inline std::string_view DisplayTransformToWire(DisplayTransformEnum transform) {
  switch (transform) {
#define DOMICILE_DISPLAY_TRANSFORM_TO_WIRE(value, wire) \
  case DisplayTransformEnum::value:                     \
    return wire;
    DOMICILE_DISPLAY_TRANSFORMS(DOMICILE_DISPLAY_TRANSFORM_TO_WIRE)
#undef DOMICILE_DISPLAY_TRANSFORM_TO_WIRE
  }
  // Mojo rejects unknown enum values on deserialization, so reaching here
  // means a bad cast in this repository.
  NOTREACHED();
}

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_COMMON_DISPLAY_TRANSFORM_H_
