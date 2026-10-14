// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DISPLAY_LIST_H_
#define COMPONENTS_DOMICILE_BROWSER_DISPLAY_LIST_H_

#include <stdint.h>

#include <string>
#include <vector>

#include "base/containers/flat_map.h"
#include "components/domicile/mojom/frame_sink_broker.mojom.h"
#include "ui/display/display.h"

namespace domicile {

// Converts ozone's displays into the list the compositor advertises as
// wl_output.
//
// Converts to wl_output units: millimeters instead of density, and mHz instead
// of Hz. The name is the `label` that
// ui/ozone/platform/drm/domicile/drm_screen.cc built from the panel's EDID.
//
// `connectors` names each display's connector by id, as
// `ui::OzonePlatform::GetDomicileConnectors` gives them. A display it does not
// name, as on a platform with no connectors, crosses with none.
std::vector<mojom::DisplayPtr> DisplayListFor(
    const std::vector<display::Display>& displays,
    const base::flat_map<int64_t, std::string>& connectors);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DISPLAY_LIST_H_
