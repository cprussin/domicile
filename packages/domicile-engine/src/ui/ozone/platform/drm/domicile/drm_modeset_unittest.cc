// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_modeset.h"

#include <memory>
#include <string>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/display/types/display_constants.h"
#include "ui/ozone/platform/drm/domicile/drm_screen.h"
#include "ui/ozone/public/ozone_platform.h"
#include "ui/ozone/platform/drm/host/drm_window_host_manager.h"
#include "ui/display/types/display_mode.h"
#include "ui/display/types/display_snapshot.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/size.h"

namespace ui {
namespace {

// Builds snapshots without the ChromeOS-only `fake_display_snapshot.h`.
// Duplicated in drm_screen_unittest.cc; share it if a third suite needs it.
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

TEST(DrmModesetTest, AReadingSaysWhatEveryConnectorReported) {
  // The mode must be logged: the browser window has to match it exactly.
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(SnapshotBuilder()
                      .Id(7)
                      .Origin(gfx::Point(0, 0))
                      .NativeMode(gfx::Size(2880, 1920), 120.f)
                      .Build());
  owned.push_back(SnapshotBuilder()
                      .Id(9)
                      .Origin(gfx::Point(2880, 0))
                      .NoNativeMode()
                      .Build());

  EXPECT_EQ(DescribeSnapshots(Pointers(owned)),
            "2 connector(s): 7 at 0,0 2880x1920@120; 9 at 2880,0 no mode");
}

TEST(DrmModesetTest, AReadingOfNothingSaysSo) {
  // An empty reading is normal and still gets a log line.
  EXPECT_EQ(DescribeSnapshots({}), "0 connector(s)");
}

TEST(DrmModesetTest, AModesetAsksForTheSnapshotsNativeMode) {
  auto snapshot = SnapshotBuilder()
                      .Id(7)
                      .NativeMode(gfx::Size(2560, 1440), 144.f)
                      .Build();
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(std::move(snapshot));

  const auto params = ModesetParamsFromSnapshots(Pointers(owned), {});

  ASSERT_EQ(params.size(), 1u);
  EXPECT_EQ(params[0].id, 7);
  ASSERT_NE(params[0].mode, nullptr);
  EXPECT_EQ(params[0].mode->size(), gfx::Size(2560, 1440));
}

// The snapshot's own origin is (0, 0) for any connector ozone has not read
// before, so identical monitors would overlap. The modeset must use the display
// list's origins, or a window sized to its display matches no CRTC.
TEST(DrmModesetTest, WithNoLayoutTheModesetLightsWhereTheDisplayListSays) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  for (const int64_t id : {11, 12, 13}) {
    owned.push_back(SnapshotBuilder()
                        .Id(id)
                        .Origin(gfx::Point(0, 0))
                        .NativeMode(gfx::Size(3840, 2160), 60.f)
                        .Build());
  }

  const auto params = ModesetParamsFromSnapshots(Pointers(owned), {});
  const std::vector<display::Display> displays =
      DisplaysFromSnapshots(Pointers(owned), {});

  ASSERT_EQ(params.size(), 3u);
  ASSERT_EQ(displays.size(), 3u);
  EXPECT_EQ(params[2].origin, gfx::Point(7680, 0));
  for (size_t i = 0; i < params.size(); ++i) {
    EXPECT_EQ(params[i].origin, displays[i].bounds().origin())
        << "connector " << params[i].id;
  }
}

// `DisplaysFromSnapshots` gives this connector a fallback, since a window needs
// somewhere to land. A modeset must not invent a mode the hardware never
// advertised.
TEST(DrmModesetTest, AConnectorWithNoModeIsNotGivenOne) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(SnapshotBuilder().Id(4).NoNativeMode().Build());

  EXPECT_TRUE(ModesetParamsFromSnapshots(Pointers(owned), {}).empty());
}

TEST(DrmModesetTest, AReadableConnectorSurvivesAnUnreadableOneBesideIt) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(SnapshotBuilder().Id(4).NoNativeMode().Build());
  owned.push_back(SnapshotBuilder()
                      .Id(5)
                      .NativeMode(gfx::Size(1280, 1024), 60.f)
                      .Build());

  const auto params = ModesetParamsFromSnapshots(Pointers(owned), {});

  ASSERT_EQ(params.size(), 1u);
  EXPECT_EQ(params[0].id, 5);
}

// The layout carries the compositor's display profile. Without it, a
// connector the profile turns off stays lit and monitors are ordered as the
// card enumerates them.
TEST(DrmModesetTest, ALayoutSaysWhereAConnectorGoes) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(
      SnapshotBuilder().Id(3).Origin(gfx::Point(1920, 0)).Build());

  const auto params = ModesetParamsFromSnapshots(
      Pointers(owned), {{.id = 3, .enabled = true, .origin = gfx::Point(0, 0)}});

  ASSERT_EQ(params.size(), 1u);
  EXPECT_EQ(params[0].origin, gfx::Point(0, 0))
      << "the layout's corner, not the one the card happened to stack it at";
}

TEST(DrmModesetTest, ALayoutCanLeaveAConnectorDark) {
  // For example, a laptop panel behind a closed lid.
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(SnapshotBuilder().Id(1).Build());
  owned.push_back(SnapshotBuilder().Id(2).Build());

  const auto params = ModesetParamsFromSnapshots(
      Pointers(owned), {{.id = 1, .enabled = false, .origin = gfx::Point()},
                        {.id = 2, .enabled = true, .origin = gfx::Point()}});

  ASSERT_EQ(params.size(), 1u);
  EXPECT_EQ(params[0].id, 2);
}

TEST(DrmModesetTest, AConnectorNoLayoutNamesIsLeftDark) {
  // A monitor plugged in after the compositor's last answer. It lights once
  // the compositor answers the hotplug this modeset triggers.
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(SnapshotBuilder().Id(1).Build());
  owned.push_back(SnapshotBuilder().Id(8).Build());

  const auto params = ModesetParamsFromSnapshots(
      Pointers(owned), {{.id = 1, .enabled = true, .origin = gfx::Point()}});

  ASSERT_EQ(params.size(), 1u);
  EXPECT_EQ(params[0].id, 1);
}

TEST(DrmModesetTest, ALayoutStillDoesNotInventAModeForAConnectorWithNone) {
  // The layout places a connector; it does not supply a mode.
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(SnapshotBuilder().Id(4).NoNativeMode().Build());

  EXPECT_TRUE(ModesetParamsFromSnapshots(
                  Pointers(owned),
                  {{.id = 4, .enabled = true, .origin = gfx::Point(0, 0)}})
                  .empty());
}

TEST(DrmModesetTest, NothingPluggedInAsksForNoModeset) {
  EXPECT_TRUE(ModesetParamsFromSnapshots({}, {}).empty());
}

TEST(DrmModesetTest, EveryReadableConnectorIsAskedFor) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(SnapshotBuilder().Id(1).Build());
  owned.push_back(SnapshotBuilder().Id(2).Origin(gfx::Point(1920, 0)).Build());

  const auto params = ModesetParamsFromSnapshots(Pointers(owned), {});

  ASSERT_EQ(params.size(), 2u);
  EXPECT_EQ(params[0].id, 1);
  EXPECT_EQ(params[1].id, 2);
}

// Each `Configure` makes the kernel emit a udev CHANGE, which triggers another
// reading. Repeating an unchanged modeset would loop and the screen would never
// settle.
TEST(DrmModesetTest, TheSameReadingTwiceIsNotWorthAModeset) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  const std::vector<display::DisplayConfigurationParams> once =
      ModesetParamsFromSnapshots(Pointers(snapshots), {});
  const std::vector<display::DisplayConfigurationParams> again =
      ModesetParamsFromSnapshots(Pointers(snapshots), {});

  EXPECT_FALSE(ModesetWouldChangeAnything(once, again))
      << "asking the hardware for the mode it just reported is the loop";
}

TEST(DrmModesetTest, TheFirstReadingIsAlwaysWorthAModeset) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());

  EXPECT_TRUE(ModesetWouldChangeAnything(
      {}, ModesetParamsFromSnapshots(Pointers(snapshots), {})))
      << "nothing has been asked for yet, so everything is a change";
}

// A real hotplug changes the reading and must always modeset.
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
      ModesetWouldChangeAnything(ModesetParamsFromSnapshots(Pointers(one), {}),
                                 ModesetParamsFromSnapshots(Pointers(two), {})));
}

TEST(DrmModesetTest, AModeChangingOnOneDisplayIsWorthAModeset) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> before;
  before.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  std::vector<std::unique_ptr<display::DisplaySnapshot>> after;
  after.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(1920, 1080), 60.f).Build());

  EXPECT_TRUE(
      ModesetWouldChangeAnything(ModesetParamsFromSnapshots(Pointers(before), {}),
                                 ModesetParamsFromSnapshots(Pointers(after), {})))
      << "the same connector at a different mode is a different request";
}

// A delegate that records each `Configure` and answers when the test says so.
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
    if (inline_answer_.has_value()) {
      std::move(callback).Run(config_requests, *inline_answer_);
      return;
    }
    pending_ = std::move(callback);
  }

  // Answers the pending `Configure` as the DRM thread would.
  void Answer(bool status) {
    ASSERT_TRUE(pending_) << "nothing was asked, so there is nothing to answer";
    std::move(pending_).Run({}, status);
  }
  // Answers from inside `Configure`, as
  // `DrmDisplayHostManager::ConfigureDisplays` does for dummy displays.
  void AnswersFromInsideConfigure(bool status) { inline_answer_ = status; }
  // Drops the pending `Configure`, as when the GPU process has no DRM device
  // yet.
  void NeverAnswers() { pending_.Reset(); }

  bool was_asked() const { return !pending_.is_null(); }
  size_t asks() const { return asked_.size(); }

  void SetSnapshots(
      std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>> s) {
    snapshots_ = std::move(s);
  }

  // Unused by these tests.
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
  std::optional<bool> inline_answer_;
};

// The first `Configure` goes out before the GPU process has a DRM device, so
// it never answers. The udev ADD that follows carries the same reading and must
// still modeset.
TEST(DrmModesetTest, AnAskThatReachedNothingDoesNotSuppressTheNextOne) {
  auto owned = std::make_unique<FakeDelegate>();
  FakeDelegate* fake = owned.get();
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  fake->SetSnapshots(Pointers(snapshots));

  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager, nullptr);
  DrmModeset modeset(std::move(owned), &screen);

  modeset.Start();
  ASSERT_EQ(fake->asks(), 1u) << "the first reading must be asked for";
  fake->NeverAnswers();  // The GPU process has no DRM device yet.

  modeset.OnConfigurationChanged();
  EXPECT_EQ(fake->asks(), 2u)
      << "an ask nothing confirmed must not suppress the ask that follows it";
}

// After a confirmed modeset, the hotplug it causes must not modeset again.
TEST(DrmModesetTest, AConfirmedModesetSuppressesTheHotplugItCauses) {
  auto owned = std::make_unique<FakeDelegate>();
  FakeDelegate* fake = owned.get();
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  fake->SetSnapshots(Pointers(snapshots));

  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager, nullptr);
  DrmModeset modeset(std::move(owned), &screen);

  modeset.Start();
  ASSERT_EQ(fake->asks(), 1u);
  fake->Answer(true);

  modeset.OnConfigurationChanged();
  EXPECT_EQ(fake->asks(), 1u)
      << "the CHANGE a successful Configure emits is this driver's own echo";
}

// After a refused modeset the hardware state is unknown, so the next reading
// must modeset.
TEST(DrmModesetTest, ARefusedModesetDoesNotSuppressTheNextOne) {
  auto owned = std::make_unique<FakeDelegate>();
  FakeDelegate* fake = owned.get();
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  fake->SetSnapshots(Pointers(snapshots));

  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager, nullptr);
  DrmModeset modeset(std::move(owned), &screen);

  modeset.Start();
  fake->Answer(false);

  modeset.OnConfigurationChanged();
  EXPECT_EQ(fake->asks(), 2u);
}

// `Start()` runs before the GPU process exists, so `DrmDisplayHostManager`
// answers from its dummy snapshots without reaching hardware. Recording that
// answer would suppress a matching first real reading, and a machine whose
// dummy reading matches its real one would never modeset.
TEST(DrmModesetTest, AnAnswerFromInsideTheAskIsNotAConfirmation) {
  auto owned = std::make_unique<FakeDelegate>();
  FakeDelegate* fake = owned.get();
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  fake->SetSnapshots(Pointers(snapshots));
  fake->AnswersFromInsideConfigure(true);

  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager, nullptr);
  DrmModeset modeset(std::move(owned), &screen);

  modeset.Start();
  ASSERT_EQ(fake->asks(), 1u) << "the first reading must be asked for";

  // The GPU process is up and reports the same displays as the dummies.
  modeset.OnConfigurationChanged();
  EXPECT_EQ(fake->asks(), 2u)
      << "a yes that arrived before the ask returned reached no hardware, so "
         "the first real reading must still get through";
}


// After a resume the GPU state is lost but the connectors report the same as
// before, so the loop guard alone would leave every panel dark.
TEST(DrmModesetTest, AWakeLightsTheScreensAgainThoughTheyReadTheSame) {
  auto owned = std::make_unique<FakeDelegate>();
  FakeDelegate* fake = owned.get();
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  fake->SetSnapshots(Pointers(snapshots));

  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager, nullptr);
  DrmModeset modeset(std::move(owned), &screen);

  modeset.Start();
  ASSERT_EQ(fake->asks(), 1u);
  fake->Answer(true);

  modeset.Relight();
  EXPECT_EQ(fake->asks(), 2u)
      << "a GPU that came back with its CRTCs reset reports what it reported "
         "before, so the reading cannot be what decides";
}

// `Relight` clears one confirmation, not the guard: the hotplug its own
// modeset causes is still suppressed.
TEST(DrmModesetTest, ARelitScreenStillSuppressesTheHotplugItCauses) {
  auto owned = std::make_unique<FakeDelegate>();
  FakeDelegate* fake = owned.get();
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  fake->SetSnapshots(Pointers(snapshots));

  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager, nullptr);
  DrmModeset modeset(std::move(owned), &screen);

  modeset.Start();
  fake->Answer(true);
  modeset.Relight();
  ASSERT_EQ(fake->asks(), 2u);
  fake->Answer(true);

  modeset.OnConfigurationChanged();
  EXPECT_EQ(fake->asks(), 2u)
      << "the CHANGE the relight's own Configure emits is still this driver's "
         "own echo";
}

}  // namespace
}  // namespace ui
