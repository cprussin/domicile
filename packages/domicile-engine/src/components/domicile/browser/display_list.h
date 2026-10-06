// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DISPLAY_LIST_H_
#define COMPONENTS_DOMICILE_BROWSER_DISPLAY_LIST_H_

#include <vector>

#include "components/domicile/mojom/frame_sink_broker.mojom.h"
#include "ui/display/display.h"

namespace domicile {

// Converts ozone's displays into the list the compositor advertises as
// wl_output.
//
// Converts to wl_output units: millimeters instead of density, and mHz instead
// of Hz. The name is the `label` that
// ui/ozone/platform/drm/domicile/drm_screen.cc built from the panel's EDID.
std::vector<mojom::DisplayPtr> DisplayListFor(
    const std::vector<display::Display>& displays);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DISPLAY_LIST_H_
