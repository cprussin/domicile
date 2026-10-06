// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_COMMON_THEME_H_
#define COMPONENTS_DOMICILE_COMMON_THEME_H_

#include <optional>
#include <string_view>

#include "base/notreached.h"

// The desktop's light or dark theme and its wire-name codec.
//
// Must match `domicile_protocol::Theme`, `domicile_config::ThemeMode` and
// `themeSchema` in `@domicile/chrome-sdk`.
//
// There is no `system` value: Domicile is the system, so there is no higher
// preference to follow. The compositor exposes this value to other apps
// through the settings portal.
//
// One x-macro list drives both directions so they cannot disagree. Callers
// drop a message with an unknown name, keeping the current theme.

// The closed set. Order matches `mojom::Theme` and `domicile_protocol::Theme`.
#define DOMICILE_THEMES(X) \
  X(kDark, "dark")         \
  X(kLight, "light")

namespace domicile {

// Parses a wire name, or returns nullopt if it is unknown.
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

// The wire name of a theme. Every enum value is in the list; the unit test
// checks that.
template <typename ThemeEnum>
inline std::string_view ThemeToWire(ThemeEnum theme) {
  switch (theme) {
#define DOMICILE_THEME_TO_WIRE(value, wire) \
  case ThemeEnum::value:                    \
    return wire;
    DOMICILE_THEMES(DOMICILE_THEME_TO_WIRE)
#undef DOMICILE_THEME_TO_WIRE
  }
  // Mojo rejects unknown enum values on deserialization, so reaching here
  // means a bad cast in this repository.
  NOTREACHED();
}

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_COMMON_THEME_H_
