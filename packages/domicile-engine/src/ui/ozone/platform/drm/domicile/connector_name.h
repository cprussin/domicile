// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_CONNECTOR_NAME_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_CONNECTOR_NAME_H_

#include <cstdint>
#include <string>

namespace ui {

// Returns the kernel's name for a DRM connector, "<TYPE>-<N>", as
// /sys/class/drm and sway spell it: "DP-1", "HDMI-A-2", "eDP-1".
//
// `type` is a `DRM_MODE_CONNECTOR_*` value and `type_id` the connector's
// number among its type. A type missing from the kernel's table here is
// "Unknown", as wlroots spells it.
//
// The compositor names a monitor with no EDID name after this. See
// docs/DISPLAYS.md#monitor-names in the Domicile repository.
//
// Uses no Chromium types so it can be tested on its own.
std::string ConnectorName(uint32_t type, uint32_t type_id);

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_CONNECTOR_NAME_H_
