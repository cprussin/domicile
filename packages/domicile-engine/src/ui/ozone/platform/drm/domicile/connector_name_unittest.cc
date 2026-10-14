// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/connector_name.h"

#include <cstdint>

#include "testing/gtest/include/gtest/gtest.h"

namespace ui {
namespace {

// The `DRM_MODE_CONNECTOR_*` values from drm_mode.h. Spelled out so the test
// reads as the kernel's table does.
constexpr uint32_t kUnknown = 0;
constexpr uint32_t kDisplayPort = 10;
constexpr uint32_t kHdmiA = 11;
constexpr uint32_t kEmbeddedDisplayPort = 14;
constexpr uint32_t kUsb = 20;

TEST(DrmConnectorNameTest, ADisplayPortIsNamedAsTheKernelNamesIt) {
  EXPECT_EQ(ConnectorName(kDisplayPort, 1), "DP-1");
}

// The kernel numbers connectors per type, from 1.
TEST(DrmConnectorNameTest, TheNumberIsTheConnectorsAmongItsType) {
  EXPECT_EQ(ConnectorName(kHdmiA, 2), "HDMI-A-2");
}

TEST(DrmConnectorNameTest, ALaptopPanelIsEmbeddedDisplayPort) {
  EXPECT_EQ(ConnectorName(kEmbeddedDisplayPort, 1), "eDP-1");
}

TEST(DrmConnectorNameTest, TheLastTypeTheKernelNamesHasItsName) {
  EXPECT_EQ(ConnectorName(kUsb, 1), "USB-1");
}

TEST(DrmConnectorNameTest, AnUnknownConnectorIsUnknown) {
  EXPECT_EQ(ConnectorName(kUnknown, 1), "Unknown-1");
}

// A newer kernel's type is still a name, as wlroots spells it.
TEST(DrmConnectorNameTest, ATypeNewerThanTheTableIsUnknown) {
  EXPECT_EQ(ConnectorName(kUsb + 1, 3), "Unknown-3");
}

}  // namespace
}  // namespace ui
