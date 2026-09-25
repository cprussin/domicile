// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_COMMON_THEME_H_
#define COMPONENTS_DOMICILE_COMMON_THEME_H_

#include <optional>
#include <string_view>

#include "base/notreached.h"

// Which way round the desktop is drawn, and the one place a wire name becomes
// one.
//
// Two members, and the same closed set as `domicile_protocol::Theme` on the
// compositor's side, `domicile_config::ThemeMode` in the file it parses, and
// `themeSchema` in `@domicile/chrome-sdk` on the page's.
//
// THERE IS NO `system` HERE AND THERE IS NOT GOING TO BE ONE. Every other
// desktop offers "follow the system" because it is a program running on one.
// Domicile is the system: this engine paints the only thing on the screen that
// is not a client, and there is nothing above it whose preference it could
// follow. What follows *this* is the rest of the desk -- the compositor
// answers the settings portal GTK, Qt and Electron read their color scheme
// from, out of the same value.
//
// THE SAME SHAPE AS `display_transform.h` NEXT DOOR, for the same reason: two
// directions -- the browser turns a wire name into an enum, Blink turns the
// enum back into the name the page reads -- and two hand-written switch
// statements can disagree where an x-macro cannot.
//
// It refuses an unknown name rather than falling back, which is
// `cursor_shape.h`'s answer rather than `display_transform.h`'s. A turn nobody
// knows arrives as one field of a whole desktop, so refusing it would cost a
// shell every screen; a theme IS the message, so there is nothing else in it
// to save -- and the desk is already painting in one of the two, which is a
// better answer than the other one picked by a typo.
//
// `theme_unittest.cc` checks the list against the mojom's own `kMaxValue`,
// which is the one number here that this file cannot get wrong.

// The closed set. Order matches `mojom::Theme` and
// `domicile_protocol::Theme`; the wire names are what the compositor
// serializes and what the config file spells.
#define DOMICILE_THEMES(X) \
  X(kDark, "dark")         \
  X(kLight, "light")

namespace domicile {

// The theme a wire name names, or nothing if it names neither.
template <typename ThemeEnum>
inline std::optional<ThemeEnum> ThemeFromWire(std::string_view name) {
#define DOMICILE_THEME_FROM_WIRE(theme, wire) \
  if (name == wire) {                         \
    return ThemeEnum::theme;                  \
  }
  DOMICILE_THEMES(DOMICILE_THEME_FROM_WIRE)
#undef DOMICILE_THEME_FROM_WIRE
  return std::nullopt;
}

// The wire name of a theme. Total, unlike the other direction: every value of
// the enum is in the list, which is what the unit test asserts.
template <typename ThemeEnum>
inline std::string_view ThemeToWire(ThemeEnum theme) {
  switch (theme) {
#define DOMICILE_THEME_TO_WIRE(value, wire) \
  case ThemeEnum::value:                    \
    return wire;
    DOMICILE_THEMES(DOMICILE_THEME_TO_WIRE)
#undef DOMICILE_THEME_TO_WIRE
  }
  // NOT a fallback to `dark`. An `enum class : int32_t` can hold a value no
  // case names, but this one cannot get here holding one: mojo checks an enum
  // on deserialization and rejects the message, so a value reaching this line
  // came from a cast in this repository and is a bug rather than a peer's
  // doing.
  NOTREACHED();
}

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_COMMON_THEME_H_
