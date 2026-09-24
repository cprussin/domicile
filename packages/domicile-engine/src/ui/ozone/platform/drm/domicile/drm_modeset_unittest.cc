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

TEST(DrmModesetTest, AReadingSaysWhatEveryConnectorReported) {
  // THREE RUNS ON REAL HARDWARE WERE SPENT INFERRING THIS FROM ABSENT LINES.
  // The mode matters twice over: it is what the CRTC is set to, and it is what
  // the browser window has to match exactly or nothing is ever scanned out.
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
  // A machine with nothing plugged in is an ordinary state, and a log line
  // that goes missing entirely is indistinguishable from one that never ran.
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

TEST(DrmModesetTest, AModesetPlacesADisplayAtItsSnapshotsOrigin) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(
      SnapshotBuilder().Id(3).Origin(gfx::Point(1920, 0)).Build());

  const auto params = ModesetParamsFromSnapshots(Pointers(owned), {});

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

// A LAYOUT IS THE COMPOSITOR'S ANSWER ABOUT WHAT THE GLASS DOES, and it
// arrives over the engine's C ABI because the compositor is the process
// holding the config and this one is the process holding DRM master. Without
// it a profile reaches the desktop the compositor advertises and nothing
// else: the connector a profile turned off goes on being lit, and the
// monitors are laid out in the order the card enumerated them.
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
  // `enabled: false` in a profile, which is how a laptop panel is named so
  // that closing the lid on a full desk still matches the desk's profile and
  // is turned off so that nothing is drawn on a panel behind a shut lid.
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
  // A monitor plugged in between the reading the compositor answered and this
  // one. It lights on the next round trip -- the modeset makes the kernel
  // emit a CHANGE, the display list goes over the ABI again, and the answer
  // that comes back names it -- and a connector lit at an origin nothing
  // chose could land on top of one that was chosen, which is the exact-rect
  // mismatch that scans out nothing at all.
  std::vector<std::unique_ptr<display::DisplaySnapshot>> owned;
  owned.push_back(SnapshotBuilder().Id(1).Build());
  owned.push_back(SnapshotBuilder().Id(8).Build());

  const auto params = ModesetParamsFromSnapshots(
      Pointers(owned), {{.id = 1, .enabled = true, .origin = gfx::Point()}});

  ASSERT_EQ(params.size(), 1u);
  EXPECT_EQ(params[0].id, 1);
}

TEST(DrmModesetTest, ALayoutStillDoesNotInventAModeForAConnectorWithNone) {
  // The layout says where a connector goes, not what it can do. A profile
  // naming a monitor that reports no mode is a profile the compositor matched
  // against a display list that named it, and asking a CRTC for a mode the
  // hardware never advertised is how a screen goes black rather than wrong.
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
    if (inline_answer_.has_value()) {
      std::move(callback).Run(config_requests, *inline_answer_);
      return;
    }
    pending_ = std::move(callback);
  }

  // What the hardware says back, when the test decides.
  void Answer(bool status) {
    ASSERT_TRUE(pending_) << "nothing was asked, so there is nothing to answer";
    std::move(pending_).Run({}, status);
  }
  // An answer that comes back out of `Configure` itself, which is what
  // `DrmDisplayHostManager::ConfigureDisplays` does for a dummy display: it
  // reads `is_dummy()` and runs the callback with `true` without leaving the
  // browser process.
  void AnswersFromInsideConfigure(bool status) { inline_answer_ = status; }
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
  std::optional<bool> inline_answer_;
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

// A YES FROM INSIDE THE BROWSER PROCESS IS NOT A CONFIRMATION EITHER, and it
// is the one that got through. `Start()` runs at `InitScreen` time, before a
// GPU process exists; `DrmDisplayHostManager::UpdateDisplays` therefore answers
// with the dummy snapshots its constructor built from its own read of the
// primary card, and `ConfigureDisplays` reads `is_dummy()` on those and runs
// the callback with `true` without leaving the process. On the machine this was
// found on, "the DRM thread confirmed the modeset" was logged three
// microseconds after "configuring 2 display(s)" -- no hardware commit had
// happened, and recording that yes is what suppresses the first REAL reading
// when it matches. A single-card machine whose dummy reading matches its real
// one would never modeset at all.
TEST(DrmModesetTest, AnAnswerFromInsideTheAskIsNotAConfirmation) {
  auto owned = std::make_unique<FakeDelegate>();
  FakeDelegate* fake = owned.get();
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(
      SnapshotBuilder().Id(11).NativeMode(gfx::Size(2880, 1920), 120.f).Build());
  fake->SetSnapshots(Pointers(snapshots));
  fake->AnswersFromInsideConfigure(true);

  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);
  DrmModeset modeset(std::move(owned), &screen);

  modeset.Start();
  ASSERT_EQ(fake->asks(), 1u) << "the first reading must be asked for";

  // The GPU thread is up now, and it reports what the dummies already said.
  modeset.OnConfigurationChanged();
  EXPECT_EQ(fake->asks(), 2u)
      << "a yes that arrived before the ask returned reached no hardware, so "
         "the first real reading must still get through";
}


// THE ONE A HOTPLUG CANNOT STAND IN FOR. logind pauses no session device and
// drops no DRM master across a suspend -- both are VT paths in its sources, and
// the session never leaves `Active` -- so the only thing lost to a sleep is the
// state inside the GPU. The connectors come back reporting exactly what they
// reported going down: same panels, same modes, same origins. Which means the
// loop guard above, whose entire job is to answer "the report has not changed,
// so asking again cannot help", is wrong for precisely this one event and would
// leave every panel dark.
TEST(DrmModesetTest, AWakeLightsTheScreensAgainThoughTheyReadTheSame) {
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

  modeset.Relight();
  EXPECT_EQ(fake->asks(), 2u)
      << "a GPU that came back with its CRTCs reset reports what it reported "
         "before, so the reading cannot be what decides";
}

// And the relight does not cost the loop guard. Forgetting one confirmation is
// the whole mechanism; forgetting it permanently would put this driver back to
// answering its own hotplugs forever, which is the bug the guard exists for.
TEST(DrmModesetTest, ARelitScreenStillSuppressesTheHotplugItCauses) {
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
