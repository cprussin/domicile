// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_HEADLESS_DOMICILE_HEADLESS_DESK_H_
#define UI_OZONE_PLATFORM_HEADLESS_DOMICILE_HEADLESS_DESK_H_

#include <stdint.h>

#include <string>
#include <vector>

#include "base/containers/flat_map.h"
#include "ui/display/display.h"
#include "ui/ozone/public/ozone_platform.h"

namespace ui {

// The switch that makes ozone headless a desktop's screens: Domicile's
// compositor adds virtual displays and lays them out, as on DRM. See
// docs/architecture/A-HEADLESS-DESKTOP.md in the Domicile repository.
inline constexpr char kDomicileHeadlessDesk[] = "domicile-headless-desk";

// The connector the placeholder display is on.
inline constexpr char kHeadlessPlaceholderConnector[] = "HEADLESS-1";

// A headless desk's displays, primary first, and each one's connector.
struct HeadlessDesk {
  std::vector<display::Display> displays;
  base::flat_map<int64_t, std::string> connectors;
};

// Returns the desk the compositor's `virtuals` make, placed by `layout`.
//
// - With no virtual display the desk is `placeholder` alone, since a screen
//   always has a primary display.
// - A display `layout` names takes its origin. The others go in order past
//   the right edge of every display placed before them.
// - Each is at scale 1, labeled with its name, on connector "virtual-<n>" as
//   DRM's `VirtualSnapshot` names it.
// - `enabled` is not read: a dark display still has its place, as on DRM.
HeadlessDesk HeadlessDeskOf(const display::Display& placeholder,
                            const std::vector<DomicileVirtualDisplay>& virtuals,
                            const std::vector<DomicileDisplayLayout>& layout);

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_HEADLESS_DOMICILE_HEADLESS_DESK_H_
