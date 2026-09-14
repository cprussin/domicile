// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_modeset.h"

#include <memory>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/display/types/display_mode.h"
#include "ui/display/types/display_snapshot.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/size.h"

namespace ui {
namespace {

// The same builder drm_screen_unittest.cc uses, and for the same reason:
// `ui/display/manager/test/fake_display_snapshot.h` is ChromeOS-only, so the
// 27-argument constructor gets filled once here too. Duplicated rather than
// shared because the two suites are the only callers and a header for two
// callers in one directory is the wrong trade -- if a third arrives, that is
// when it moves.
class SnapshotBuilder {
 public:
  SnapshotBuilder& Id(int64_t id) {
    id_ = id;
    return *this;
  }
  SnapshotBuilder& Origin(const gfx::Point& origin) {
    origin_ = origin;
    return *this;
  }
  SnapshotBuilder& NativeMode(const gfx::Size& size, float refresh_hz) {
    native_mode_size_ = size;
    native_refresh_hz_ = refresh_hz;
    return *this;
  }
  SnapshotBuilder& NoNativeMode() {
    native_mode_size_.reset();
    return *this;
  }

  std::unique_ptr<display::DisplaySnapshot> Build() {
    display::DisplaySnapshot::DisplayModeList modes;
    const display::DisplayMode* native = nullptr;
    if (native_mode_size_.has_value()) {
      modes.push_back(std::make_unique<display::DisplayMode>(
          *native_mode_size_, /*interlaced=*/false, native_refresh_hz_));
      native = modes.back().get();
    }
    return std::make_unique<display::DisplaySnapshot>(
        id_, id_, id_, /*connector_index=*/0u, origin_, gfx::Size(520, 320),
        display::DISPLAY_CONNECTION_TYPE_HDMI, /*base_connector_id=*/1u,
        /*path_topology=*/std::vector<uint64_t>(),
        /*is_aspect_preserving_scaling=*/false, /*has_overscan=*/false,
        display::PrivacyScreenState::kNotSupported,
        /*has_content_protection_key=*/false,
        display::DisplaySnapshot::ColorInfo(), "a panel", base::FilePath(),
        std::move(modes), display::PanelOrientation::kNormal,
        /*edid=*/std::vector<uint8_t>(),
        /*current_mode=*/native, native, /*product_code=*/0,
        /*year_of_manufacture=*/0, gfx::Size(),
        display::VariableRefreshRateState::kVrrNotCapable,
        display::DrmFormatsAndModifiers());
  }

 private:
  int64_t id_ = 1;
  gfx::Point origin_;
  std::optional<gfx::Size> native_mode_size_ = gfx::Size(1920, 1080);
  float native_refresh_hz_ = 60.f;
};

std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>> Pointers(
    const std::vector<std::unique_ptr<display::DisplaySnapshot>>& owned) {
  std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>> pointers;
  for (const std::unique_ptr<display::DisplaySnapshot>& snapshot : owned) {
    pointers.push_back(snapshot.get());
  }
  return pointers;
}

TEST(DrmModesetTest, AModesetAsksForTheSnapshotsNativeMode) {
  auto snapshot = SnapshotBuilder()
                      .Id(7)
                      .NativeMode(gfx::Size(2560, 1440), 144.f)
                      .Build();
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(std::move(snapshot));

  const auto params = ModesetParamsFromSnapshots(Pointers(owned));

  ASSERT_EQ(params.size(), 1u);
  EXPECT_EQ(params[0].id, 7);
  ASSERT_NE(params[0].mode, nullptr);
  EXPECT_EQ(params[0].mode->size(), gfx::Size(2560, 1440));
}

TEST(DrmModesetTest, AModesetPlacesADisplayAtItsSnapshotsOrigin) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(
      SnapshotBuilder().Id(3).Origin(gfx::Point(1920, 0)).Build());

  const auto params = ModesetParamsFromSnapshots(Pointers(owned));

  ASSERT_EQ(params.size(), 1u);
  EXPECT_EQ(params[0].origin, gfx::Point(1920, 0));
}

// The opposite of what DisplaysFromSnapshots does with the same input, and the
// difference is the point: a display list must answer for every connector
// because a window has to land somewhere, and a modeset must not invent a mode
// the hardware never advertised.
TEST(DrmModesetTest, AConnectorWithNoModeIsNotGivenOne) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(SnapshotBuilder().Id(4).NoNativeMode().Build());

  EXPECT_TRUE(ModesetParamsFromSnapshots(Pointers(owned)).empty());
}

TEST(DrmModesetTest, AReadableConnectorSurvivesAnUnreadableOneBesideIt) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(SnapshotBuilder().Id(4).NoNativeMode().Build());
  owned.push_back(SnapshotBuilder()
                      .Id(5)
                      .NativeMode(gfx::Size(1280, 1024), 60.f)
                      .Build());

  const auto params = ModesetParamsFromSnapshots(Pointers(owned));

  ASSERT_EQ(params.size(), 1u);
  EXPECT_EQ(params[0].id, 5);
}

TEST(DrmModesetTest, NothingPluggedInAsksForNoModeset) {
  EXPECT_TRUE(ModesetParamsFromSnapshots({}).empty());
}

TEST(DrmModesetTest, EveryReadableConnectorIsAskedFor) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(SnapshotBuilder().Id(1).Build());
  owned.push_back(SnapshotBuilder().Id(2).Origin(gfx::Point(1920, 0)).Build());

  const auto params = ModesetParamsFromSnapshots(Pointers(owned));

  ASSERT_EQ(params.size(), 2u);
  EXPECT_EQ(params[0].id, 1);
  EXPECT_EQ(params[1].id, 2);
}

}  // namespace
}  // namespace ui
