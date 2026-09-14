// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_screen.h"

#include <memory>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/display/display_observer.h"
#include "ui/display/types/display_mode.h"
#include "ui/display/types/display_snapshot.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"
#include "ui/ozone/platform/drm/host/drm_window_host_manager.h"

namespace ui {
namespace {

// `ui/display/manager/test/fake_display_snapshot.h` is the builder that makes
// a snapshot pleasant to construct, and it is the one thing patch 0012 had to
// gate off Linux: `//ui/display:test_support` compiles `manager/test/*` only
// `if (is_chromeos)`. So this fills the 27-argument constructor once, and each
// test varies only what it is about.
class SnapshotBuilder {
 public:
  SnapshotBuilder() = default;

  SnapshotBuilder& Id(int64_t id) {
    id_ = id;
    return *this;
  }
  SnapshotBuilder& Origin(const gfx::Point& origin) {
    origin_ = origin;
    return *this;
  }
  // Millimeters, which is what DisplaySnapshot means by physical size and what
  // wl_output wants. See A-DESKTOP-ON-A-TTY.md.
  SnapshotBuilder& PhysicalSizeMm(const gfx::Size& mm) {
    physical_size_mm_ = mm;
    return *this;
  }
  SnapshotBuilder& Name(std::string name) {
    name_ = std::move(name);
    return *this;
  }
  SnapshotBuilder& NativeMode(const gfx::Size& size, float refresh_hz) {
    native_mode_size_ = size;
    native_refresh_hz_ = refresh_hz;
    return *this;
  }
  // A snapshot with no native mode is what a connected-but-unreadable
  // connector looks like; the conversion has to have an answer for it.
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
        id_, id_, id_, /*connector_index=*/0u, origin_, physical_size_mm_,
        display::DISPLAY_CONNECTION_TYPE_HDMI, /*base_connector_id=*/1u,
        /*path_topology=*/std::vector<uint64_t>(),
        /*is_aspect_preserving_scaling=*/false, /*has_overscan=*/false,
        display::PrivacyScreenState::kNotSupported,
        /*has_content_protection_key=*/false, display::DisplaySnapshot::ColorInfo(),
        name_, base::FilePath(), std::move(modes),
        display::PanelOrientation::kNormal, /*edid=*/std::vector<uint8_t>(),
        /*current_mode=*/native, native, /*product_code=*/0,
        /*year_of_manufacture=*/0, gfx::Size(),
        display::VariableRefreshRateState::kVrrNotCapable,
        display::DrmFormatsAndModifiers());
  }

 private:
  int64_t id_ = 1;
  gfx::Point origin_;
  gfx::Size physical_size_mm_{520, 320};
  std::string name_ = "a panel";
  std::optional<gfx::Size> native_mode_size_ = gfx::Size(1920, 1080);
  float native_refresh_hz_ = 60.f;
};

TEST(DrmScreenTest, ADisplayTakesItsBoundsFromTheSnapshotsNativeMode) {
  auto snapshot = SnapshotBuilder()
                      .Id(7)
                      .Origin(gfx::Point(0, 0))
                      .NativeMode(gfx::Size(2560, 1440), 144.f)
                      .Build();

  const display::Display display = DisplayFromSnapshot(*snapshot);

  EXPECT_EQ(display.id(), 7);
  EXPECT_EQ(display.bounds(), gfx::Rect(0, 0, 2560, 1440));
}

TEST(DrmScreenTest, ADisplayIsPlacedAtTheSnapshotsOrigin) {
  auto snapshot = SnapshotBuilder()
                      .Origin(gfx::Point(1920, 0))
                      .NativeMode(gfx::Size(1280, 1024), 60.f)
                      .Build();

  EXPECT_EQ(DisplayFromSnapshot(*snapshot).bounds(),
            gfx::Rect(1920, 0, 1280, 1024));
}

// The reason this conversion exists rather than DisplayChangeObserver's: the
// millimeters are already in the snapshot, and the compositor currently
// fabricates them as (300, 200). See A-DESKTOP-ON-A-TTY.md.
TEST(DrmScreenTest, APhysicalSizeInMillimetersSurvivesTheConversion) {
  auto snapshot = SnapshotBuilder().PhysicalSizeMm(gfx::Size(597, 336)).Build();

  const display::Display display = DisplayFromSnapshot(*snapshot);

  EXPECT_EQ(display.native_origin(), gfx::Point());
  EXPECT_EQ(DisplayPhysicalSizeMm(*snapshot), gfx::Size(597, 336));
}

TEST(DrmScreenTest, ASnapshotWithNoNativeModeStillProducesAUsableDisplay) {
  auto snapshot = SnapshotBuilder().Id(3).NoNativeMode().Build();

  const display::Display display = DisplayFromSnapshot(*snapshot);

  EXPECT_EQ(display.id(), 3);
  EXPECT_FALSE(display.bounds().IsEmpty())
      << "a display with an empty bounds is one no window can be placed on";
}

// crux -- the machine this is written on -- has four connectors and all four
// read `disconnected`, so this is the ordinary path there rather than an edge
// case. PlatformScreen's contract is that a screen always has a primary:
// HeadlessScreen CHECKs its primary iterator, and aura dereferences the result.
// So clearing the NOTREACHED() at ozone_platform_drm.cc:86 without this would
// move the crash rather than remove it.
TEST(DrmScreenTest, NoSnapshotsAtAllStillYieldsOnePrimaryDisplay) {
  const std::vector<display::Display> displays =
      DisplaysFromSnapshots(std::vector<raw_ptr<display::DisplaySnapshot>>());

  ASSERT_EQ(displays.size(), 1u)
      << "a tty with nothing plugged in still has to answer GetPrimaryDisplay";
  EXPECT_FALSE(displays.front().bounds().IsEmpty());
}

// The screen holds the manager the browser process owns. An empty one is the
// whole of what these need: the widget lookups are the only members that read
// it, and the one tested below is the case where it holds nothing.
std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>> Pointers(
    const std::vector<std::unique_ptr<display::DisplaySnapshot>>& owned) {
  std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>> pointers;
  for (const std::unique_ptr<display::DisplaySnapshot>& snapshot : owned) {
    pointers.push_back(snapshot.get());
  }
  return pointers;
}

class RecordingObserver : public display::DisplayObserver {
 public:
  void OnDisplayAdded(const display::Display& display) override {
    added_.push_back(display.id());
  }

  const std::vector<int64_t>& added() const { return added_; }

 private:
  std::vector<int64_t> added_;
};

TEST(DrmScreenTest, TheFirstSnapshotIsThePrimaryDisplay) {
  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(SnapshotBuilder().Id(11).Build());
  snapshots.push_back(
      SnapshotBuilder().Id(12).Origin(gfx::Point(1920, 0)).Build());

  screen.OnDisplaysChanged(Pointers(snapshots));

  EXPECT_EQ(screen.GetAllDisplays().size(), 2u);
  EXPECT_EQ(screen.GetPrimaryDisplay().id(), 11);
}

// What OzonePlatformDrm::InitScreen does before the modeset driver has run,
// and what every connector on crux reports besides.
TEST(DrmScreenTest, AScreenToldOfNoDisplaysStillAnswersWithAPrimary) {
  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);

  screen.OnDisplaysChanged({});

  EXPECT_FALSE(screen.GetPrimaryDisplay().bounds().IsEmpty());
}

// A hotplug is a whole new list rather than a delta, so the display that left
// has to leave the list with it.
TEST(DrmScreenTest, AHotplugReplacesTheListRatherThanAppendingToIt) {
  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);
  std::vector<std::unique_ptr<display::DisplaySnapshot>> unplugged;
  unplugged.push_back(SnapshotBuilder().Id(11).Build());
  screen.OnDisplaysChanged(Pointers(unplugged));
  std::vector<std::unique_ptr<display::DisplaySnapshot>> plugged;
  plugged.push_back(SnapshotBuilder().Id(12).Build());

  screen.OnDisplaysChanged(Pointers(plugged));

  ASSERT_EQ(screen.GetAllDisplays().size(), 1u);
  EXPECT_EQ(screen.GetAllDisplays().front().id(), 12);
}

// DisplayList notifies from AddOrUpdateDisplay, which is why hotplug needs no
// observer code here. This is the test that says so.
TEST(DrmScreenTest, AHotplugReachesADisplayObserver) {
  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);
  RecordingObserver observer;
  screen.AddObserver(&observer);
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(SnapshotBuilder().Id(11).Build());

  screen.OnDisplaysChanged(Pointers(snapshots));

  EXPECT_EQ(observer.added(), std::vector<int64_t>{11});
  screen.RemoveObserver(&observer);
}

TEST(DrmScreenTest, APointBelongsToTheDisplayItFallsOn) {
  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(1920, 1080), 60.f).Build());
  snapshots.push_back(SnapshotBuilder()
                          .Id(12)
                          .Origin(gfx::Point(1920, 0))
                          .NativeMode(gfx::Size(1280, 1024), 60.f)
                          .Build());
  screen.OnDisplaysChanged(Pointers(snapshots));

  EXPECT_EQ(screen.GetDisplayNearestPoint(gfx::Point(2000, 10)).id(), 12);
}

TEST(DrmScreenTest, ARectBelongsToTheDisplayItOverlapsMost) {
  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(1920, 1080), 60.f).Build());
  snapshots.push_back(SnapshotBuilder()
                          .Id(12)
                          .Origin(gfx::Point(1920, 0))
                          .NativeMode(gfx::Size(1280, 1024), 60.f)
                          .Build());
  screen.OnDisplaysChanged(Pointers(snapshots));

  EXPECT_EQ(screen.GetDisplayMatching(gfx::Rect(1820, 0, 400, 200)).id(), 12);
}

// DrmWindowHostManager::GetWindow() is NOTREACHED() on a widget it does not
// hold, and this member is handed widgets from other screens. Asking first is
// what keeps that a lookup rather than a crash in the browser process.
TEST(DrmScreenTest, AWidgetWithNoWindowGetsThePrimaryRatherThanACrash) {
  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(SnapshotBuilder().Id(11).Build());
  screen.OnDisplaysChanged(Pointers(snapshots));

  EXPECT_EQ(screen.GetDisplayForAcceleratedWidget(
                static_cast<gfx::AcceleratedWidget>(7))
                .id(),
            11);
}

// The pair below are not tests of arithmetic -- they are tests that the screen
// ANSWERS. PlatformScreen's own defaults return the same two values, so a
// DrmScreen that forgot these overrides would pass any assertion on the value
// alone; what these pin is the contract, so that a later "implementation" that
// starts reporting a saver nobody can turn on, or an idle time measured from
// nothing, has to change a test that says why it should not.
TEST(DrmScreenTest, NoOtherClientIsHoldingTheScreen) {
  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);

  EXPECT_FALSE(screen.IsScreenSaverActive());
}

TEST(DrmScreenTest, IdleIsTheCompositorsToMeasureAndSoIsReportedAsNone) {
  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);

  EXPECT_TRUE(screen.CalculateIdleTime().is_zero());
}

}  // namespace
}  // namespace ui
