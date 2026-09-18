// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_COMMON_DISPLAY_TRANSFORM_H_
#define COMPONENTS_DOMICILE_COMMON_DISPLAY_TRANSFORM_H_

#include <optional>
#include <string_view>

#include "base/notreached.h"

// Which way up a monitor is bolted to the desk, and the one place a wire name
// becomes one.
//
// The four `wl_output.transform` rotations, spelled the way the config file
// writes them. The same closed set as `domicile_protocol::DisplayTransform` on
// the compositor's side, `domicile_config::Transform` in the file it parses,
// and `displayTransformSchema` in `@domicile/chrome-sdk` on the page's.
//
// NAMED FOR THE TURN THE CONTENT TAKES, not the one the panel did. That is the
// `wl_output` convention and the config's: `transform_90` is an output rotated
// a quarter turn anticlockwise, so what is drawn on it has to go a quarter
// turn *clockwise* to come out upright, and `rotate-90` is that clockwise
// turn. A page applies it as written.
//
// THE SAME SHAPE AS `cursor_shape.h` NEXT DOOR, for the same reason and with
// one difference. The reason: there are two directions -- the browser turns a
// wire name into an enum, Blink turns the enum back into the string the page
// reads -- and two hand-written switch statements can disagree, where an
// x-macro cannot. The difference is what an unknown name means. A cursor
// nobody knows is a disagreement worth dropping the message over, because CSS
// silently ignores a keyword it does not have and the symptom is an arrow
// where a hand should be. A transform nobody knows is a *rotation*, and
// dropping the whole desktop description over one would leave a shell with no
// screens at all -- so the caller here falls back to `kNormal`, which is the
// arrangement that is right whenever there is nothing to turn and the one a
// page produces if it never hears of transforms. The fallback is the caller's
// to make: this returns `std::nullopt` and says nothing about what to do.
//
// `display_transform_unittest.cc` checks the list against the mojom's own
// `kMaxValue`, which is the one number here that this file cannot get wrong.

// The closed set. Order matches `mojom::DisplayTransform` and
// `domicile_protocol::DisplayTransform`; the wire names are what the
// compositor serializes and what the config file spells.
#define DOMICILE_DISPLAY_TRANSFORMS(X) \
  X(kNormal, "normal")                 \
  X(kRotate90, "rotate-90")            \
  X(kRotate180, "rotate-180")          \
  X(kRotate270, "rotate-270")

namespace domicile {

// The turn a wire name names, or nothing if it names none of them.
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

// The wire name of a turn. Total, unlike the other direction: every value of
// the enum is in the list, which is what the unit test asserts.
template <typename DisplayTransformEnum>
inline std::string_view DisplayTransformToWire(DisplayTransformEnum transform) {
  switch (transform) {
#define DOMICILE_DISPLAY_TRANSFORM_TO_WIRE(value, wire) \
  case DisplayTransformEnum::value:                     \
    return wire;
    DOMICILE_DISPLAY_TRANSFORMS(DOMICILE_DISPLAY_TRANSFORM_TO_WIRE)
#undef DOMICILE_DISPLAY_TRANSFORM_TO_WIRE
  }
  // NOT a fallback to `normal`, which is the right answer at the boundary and
  // the wrong one here. An `enum class : int32_t` can hold a value no case
  // names, but this one cannot get here holding one: mojo checks an enum on
  // deserialization and rejects the message, so a value reaching this line
  // came from a cast in this repository and is a bug rather than a peer's
  // doing.
  NOTREACHED();
}

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_COMMON_DISPLAY_TRANSFORM_H_
