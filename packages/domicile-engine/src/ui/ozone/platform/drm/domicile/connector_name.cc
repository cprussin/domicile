// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/connector_name.h"

#include <array>
#include <string_view>

namespace ui {
namespace {

// The kernel's `drm_connector_enum_list`, indexed by `DRM_MODE_CONNECTOR_*`.
constexpr auto kTypeNames = std::to_array<std::string_view>({
    "Unknown",   "VGA",  "DVI-I",     "DVI-D",   "DVI-A", "Composite",
    "SVIDEO",    "LVDS", "Component", "DIN",     "DP",    "HDMI-A",
    "HDMI-B",    "TV",   "eDP",       "Virtual", "DSI",   "DPI",
    "Writeback", "SPI",  "USB",
});

}  // namespace

std::string ConnectorName(uint32_t type, uint32_t type_id) {
  const std::string_view name =
      type < kTypeNames.size() ? kTypeNames[type] : kTypeNames[0];
  return std::string(name) + "-" + std::to_string(type_id);
}

}  // namespace ui
