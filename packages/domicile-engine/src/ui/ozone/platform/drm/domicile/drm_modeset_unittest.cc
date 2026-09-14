// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_modeset.h"

#include <memory>
#include <string>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/display/types/display_constants.h"
#include "ui/ozone/platform/drm/domicile/drm_screen.h"
#include "ui/ozone/platform/drm/host/drm_window_host_manager.h"
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

// THE LOOP, AND WHY THESE FOUR CASES ARE THE WHOLE OF IT. The first run of
// this driver on real hardware re-modeset a CRTC to the mode it was already in,
// for as long as it was left running. Every `Configure` makes the kernel emit a
// udev CHANGE; the browser turns that into `OnConfigurationChanged`; this
// driver read the displays and configured them again. A screen that
// re-modesets on a loop never settles enough to show anything, which is what
// "it goes black and nothing draws" was.
TEST(DrmModesetTest, TheSameReadingTwiceIsNotWorthAModeset) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  const std::vector<display::DisplayConfigurationParams> once =
      ModesetParamsFromSnapshots(Pointers(snapshots));
  const std::vector<display::DisplayConfigurationParams> again =
      ModesetParamsFromSnapshots(Pointers(snapshots));

  EXPECT_FALSE(ModesetWouldChangeAnything(once, again))
      << "asking the hardware for the mode it just reported is the loop";
}

TEST(DrmModesetTest, TheFirstReadingIsAlwaysWorthAModeset) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());

  EXPECT_TRUE(ModesetWouldChangeAnything(
      {}, ModesetParamsFromSnapshots(Pointers(snapshots))))
      << "nothing has been asked for yet, so everything is a change";
}

// A REAL HOTPLUG MUST ALWAYS GET THROUGH, which is the half of this that a
// too-eager guard would break. A monitor unplugged, a mode changed, a second
// screen arriving: each changes the reading, and each has to reach the
// hardware.
TEST(DrmModesetTest, ADisplayArrivingIsWorthAModeset) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> one;
  one.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  std::vector<std::unique_ptr<display::DisplaySnapshot>> two;
  two.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  two.push_back(SnapshotBuilder()
                    .Id(12)
                    .Origin(gfx::Point(2880, 0))
                    .NativeMode(gfx::Size(3840, 2160), 60.f)
                    .Build());

  EXPECT_TRUE(
      ModesetWouldChangeAnything(ModesetParamsFromSnapshots(Pointers(one)),
                                 ModesetParamsFromSnapshots(Pointers(two))));
}

TEST(DrmModesetTest, AModeChangingOnOneDisplayIsWorthAModeset) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> before;
  before.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  std::vector<std::unique_ptr<display::DisplaySnapshot>> after;
  after.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(1920, 1080), 60.f).Build());

  EXPECT_TRUE(
      ModesetWouldChangeAnything(ModesetParamsFromSnapshots(Pointers(before)),
                                 ModesetParamsFromSnapshots(Pointers(after))))
      << "the same connector at a different mode is a different request";
}

// A delegate that answers when the test says so, and remembers what it was
// asked. THE WIRING IS WHAT WENT WRONG TWICE, so the wiring is what this tests:
// the arithmetic above was right both times and neither bug was in it.
class FakeDelegate : public display::NativeDisplayDelegate {
 public:
  // display::NativeDisplayDelegate, the parts these tests drive:
  void GetDisplays(display::GetDisplaysCallback callback) override {
    std::move(callback).Run(snapshots_);
  }
  void Configure(
      const std::vector<display::DisplayConfigurationParams>& config_requests,
      display::ConfigureCallback callback,
      display::ModesetFlags modeset_flags) override {
    asked_.push_back(config_requests);
    pending_ = std::move(callback);
  }

  // What the hardware says back, when the test decides.
  void Answer(bool status) {
    ASSERT_TRUE(pending_) << "nothing was asked, so there is nothing to answer";
    std::move(pending_).Run({}, status);
  }
  // An ask that reaches nothing: the GPU thread has no DRM device yet, so the
  // callback never comes. This is the case the first fix got wrong.
  void NeverAnswers() { pending_.Reset(); }

  bool was_asked() const { return !pending_.is_null(); }
  size_t asks() const { return asked_.size(); }

  void SetSnapshots(
      std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>> s) {
    snapshots_ = std::move(s);
  }

  // The rest of the interface, which these tests do not drive.
  void Initialize() override {}
  void TakeDisplayControl(display::DisplayControlCallback callback) override {
    std::move(callback).Run(true);
  }
  void RelinquishDisplayControl(
      display::DisplayControlCallback callback) override {
    std::move(callback).Run(true);
  }
  void SetHdcpKeyProp(int64_t,
                      const std::string&,
                      display::SetHdcpKeyPropCallback callback) override {
    std::move(callback).Run(false);
  }
  void GetHDCPState(const display::DisplaySnapshot&,
                    display::GetHDCPStateCallback callback) override {
    std::move(callback).Run(false, display::HDCPState::HDCP_STATE_UNDESIRED,
                            display::CONTENT_PROTECTION_METHOD_NONE);
  }
  void SetHDCPState(const display::DisplaySnapshot&,
                    display::HDCPState,
                    display::ContentProtectionMethod,
                    display::SetHDCPStateCallback callback) override {
    std::move(callback).Run(false);
  }
  void SetColorTemperatureAdjustment(
      int64_t,
      const display::ColorTemperatureAdjustment&) override {}
  void SetColorCalibration(int64_t,
                           const display::ColorCalibration&) override {}
  void SetGammaAdjustment(int64_t, const display::GammaAdjustment&) override {}
  void SetPrivacyScreen(int64_t,
                        bool,
                        display::SetPrivacyScreenCallback callback) override {
    std::move(callback).Run(false);
  }
  void GetSeamlessRefreshRates(
      int64_t,
      display::GetSeamlessRefreshRatesCallback callback) const override {
    std::move(callback).Run(std::nullopt);
  }
  void AddObserver(display::NativeDisplayObserver*) override {}
  void RemoveObserver(display::NativeDisplayObserver*) override {}
  display::FakeDisplayController* GetFakeDisplayController() override {
    return nullptr;
  }

 private:
  std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>> snapshots_;
  std::vector<std::vector<display::DisplayConfigurationParams>> asked_;
  display::ConfigureCallback pending_;
};

// THE BUG THIS EXISTS FOR, and it is the one the first fix introduced. The
// driver's first `Configure` goes out before the GPU thread has added a DRM
// device, so it reaches nothing and never answers. Three seconds later the udev
// ADD arrives with the same reading. If the first ask was remembered, that
// second one -- the one that would have worked -- is suppressed, and the
// machine never modesets at all. Which is exactly what it did.
TEST(DrmModesetTest, AnAskThatReachedNothingDoesNotSuppressTheNextOne) {
  auto owned = std::make_unique<FakeDelegate>();
  FakeDelegate* fake = owned.get();
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  fake->SetSnapshots(Pointers(snapshots));

  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);
  DrmModeset modeset(std::move(owned), &screen);

  modeset.Start();
  ASSERT_EQ(fake->asks(), 1u) << "the first reading must be asked for";
  fake->NeverAnswers();  // The GPU thread had no device to send it to.

  modeset.OnConfigurationChanged();
  EXPECT_EQ(fake->asks(), 2u)
      << "an ask nothing confirmed must not suppress the ask that follows it";
}

// The other half, and the loop this whole guard exists for: once the hardware
// HAS confirmed, the hotplug that confirmation causes must not be answered.
TEST(DrmModesetTest, AConfirmedModesetSuppressesTheHotplugItCauses) {
  auto owned = std::make_unique<FakeDelegate>();
  FakeDelegate* fake = owned.get();
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  fake->SetSnapshots(Pointers(snapshots));

  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);
  DrmModeset modeset(std::move(owned), &screen);

  modeset.Start();
  ASSERT_EQ(fake->asks(), 1u);
  fake->Answer(true);

  modeset.OnConfigurationChanged();
  EXPECT_EQ(fake->asks(), 1u)
      << "the CHANGE a successful Configure emits is this driver's own echo";
}

// A refusal is not a state either. The hardware is in something this process
// did not choose, so the next reading has to reach it.
TEST(DrmModesetTest, ARefusedModesetDoesNotSuppressTheNextOne) {
  auto owned = std::make_unique<FakeDelegate>();
  FakeDelegate* fake = owned.get();
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  fake->SetSnapshots(Pointers(snapshots));

  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);
  DrmModeset modeset(std::move(owned), &screen);

  modeset.Start();
  fake->Answer(false);

  modeset.OnConfigurationChanged();
  EXPECT_EQ(fake->asks(), 2u);
}

}  // namespace
}  // namespace ui
