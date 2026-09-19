// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_screen.h"

#include <memory>
#include <string>
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
  // The packed manufacturer and product ids, which is where the three-letter
  // make comes from. `0x10AC` is "DEL".
  SnapshotBuilder& ProductCode(int64_t product_code) {
    product_code_ = product_code;
    return *this;
  }
  // The raw EDID, which is the only place the printed serial survives:
  // display::EdidParser keeps a hash of it and nothing else.
  SnapshotBuilder& Edid(std::vector<uint8_t> edid) {
    edid_ = std::move(edid);
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
        display::PanelOrientation::kNormal, edid_,
        /*current_mode=*/native, native, product_code_,
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
  int64_t product_code_ = display::DisplaySnapshot::kInvalidProductCode;
  std::vector<uint8_t> edid_;
};

// An EDID carrying `serial` in its first display descriptor, which is all
// these tests need out of one. edid_name_unittest.cc is where the descriptor
// walk itself is argued.
std::vector<uint8_t> EdidWithSerial(const std::string& serial) {
  std::vector<uint8_t> edid(128, 0);
  constexpr size_t kFirstDescriptor = 0x36;
  edid[kFirstDescriptor + 3] = 0xFF;
  for (size_t i = 0; i < 13; ++i) {
    edid[kFirstDescriptor + 5 + i] =
        i < serial.size() ? static_cast<uint8_t>(serial[i]) : 0x20;
  }
  return edid;
}

// 'D', 'E', 'L' packed five bits to a letter, which is what a Dell's EDID
// carries and what `ManufacturerIdToString` decodes.
constexpr int64_t kDellProductCode = (int64_t{0x10AC} << 16) | 0x41A0;

// WHY A DISPLAY HAS A NAME AT ALL. `display_id()` is already good identity --
// EDID-derived, stable across a hotplug, and different for two identical
// monitors. What it is not is something a person can predict: it is an int64,
// so writing "put the left-hand monitor here" means reading one off a log and
// typing a number that means nothing. The label is the same panel spelled the
// way it is labeled, and it is the string kanshi and sway match a profile on.
TEST(DrmScreenTest, ADisplayIsNamedByItsPanel) {
  auto snapshot = SnapshotBuilder()
                      .ProductCode(kDellProductCode)
                      .Name("DELL U3219Q")
                      .Edid(EdidWithSerial("2ZLS413"))
                      .Build();

  EXPECT_EQ(DisplayNameFromSnapshot(*snapshot), "DEL DELL U3219Q 2ZLS413");
  EXPECT_EQ(DisplayFromSnapshot(*snapshot, snapshot->origin()).label(), "DEL DELL U3219Q 2ZLS413");
}

// The case the whole change exists for: three of the same monitor on one desk.
// Make and model are identical, so the serial is the only thing that tells
// them apart -- and it is the one part display::EdidParser throws away, since
// it keeps a hash of the serial rather than the serial.
TEST(DrmScreenTest, ThreeIdenticalMonitorsGetThreeDifferentNames) {
  auto left = SnapshotBuilder()
                  .ProductCode(kDellProductCode)
                  .Name("DELL U3219Q")
                  .Edid(EdidWithSerial("2ZLS413"))
                  .Build();
  auto center = SnapshotBuilder()
                    .ProductCode(kDellProductCode)
                    .Name("DELL U3219Q")
                    .Edid(EdidWithSerial("G3MS413"))
                    .Build();
  auto right = SnapshotBuilder()
                   .ProductCode(kDellProductCode)
                   .Name("DELL U3219Q")
                   .Edid(EdidWithSerial("H8KF413"))
                   .Build();

  EXPECT_EQ(DisplayNameFromSnapshot(*left), "DEL DELL U3219Q 2ZLS413");
  EXPECT_EQ(DisplayNameFromSnapshot(*center), "DEL DELL U3219Q G3MS413");
  EXPECT_EQ(DisplayNameFromSnapshot(*right), "DEL DELL U3219Q H8KF413");
}

// A snapshot nobody set a product code on: `kInvalidProductCode` decodes to
// three backticks, which is a name that looks like a name. The make is dropped
// and the rest of it still reads.
TEST(DrmScreenTest, ADisplayWithNoProductCodeIsNotNamedAfterTheArithmetic) {
  auto snapshot = SnapshotBuilder()
                      .Name("DELL U3219Q")
                      .Edid(EdidWithSerial("2ZLS413"))
                      .Build();

  EXPECT_EQ(DisplayNameFromSnapshot(*snapshot), "DELL U3219Q 2ZLS413");
}

// A monitor with nothing to say about itself. The label is left unset rather
// than set to the empty string: a display list where every entry is named ""
// looks like an answer, and the id is still there to fall back on.
TEST(DrmScreenTest, ADisplayThatNamesItselfNothingIsLeftUnnamed) {
  auto snapshot = SnapshotBuilder().Name("").Build();

  EXPECT_EQ(DisplayNameFromSnapshot(*snapshot), "");
  EXPECT_TRUE(DisplayFromSnapshot(*snapshot, snapshot->origin()).label().empty());
}

TEST(DrmScreenTest, ADisplayTakesItsBoundsFromTheSnapshotsNativeMode) {
  auto snapshot = SnapshotBuilder()
                      .Id(7)
                      .Origin(gfx::Point(0, 0))
                      .NativeMode(gfx::Size(2560, 1440), 144.f)
                      .Build();

  const display::Display display = DisplayFromSnapshot(*snapshot, snapshot->origin());

  EXPECT_EQ(display.id(), 7);
  EXPECT_EQ(display.bounds(), gfx::Rect(0, 0, 2560, 1440));
}

TEST(DrmScreenTest, ADisplayIsPlacedAtTheSnapshotsOrigin) {
  auto snapshot = SnapshotBuilder()
                      .Origin(gfx::Point(1920, 0))
                      .NativeMode(gfx::Size(1280, 1024), 60.f)
                      .Build();

  EXPECT_EQ(DisplayFromSnapshot(*snapshot, snapshot->origin()).bounds(),
            gfx::Rect(1920, 0, 1280, 1024));
}

// The reason this conversion exists rather than DisplayChangeObserver's: the
// millimeters are already in the snapshot, and the compositor cannot read
// them. See A-DESKTOP-ON-A-TTY.md.
TEST(DrmScreenTest, APhysicalSizeInMillimetersSurvivesTheConversion) {
  auto snapshot = SnapshotBuilder().PhysicalSizeMm(gfx::Size(597, 336)).Build();

  const display::Display display = DisplayFromSnapshot(*snapshot, snapshot->origin());

  EXPECT_EQ(display.native_origin(), gfx::Point());
  EXPECT_EQ(DisplayPhysicalSizeMm(*snapshot), gfx::Size(597, 336));
}

// display::Display has no millimeters -- it has a DPI -- and it is the only
// thing that crosses from here to the browser code that builds the producer's
// display list. So the panel's size leaves as the density it makes with the
// mode, and `components/domicile/browser/display_list.cc` divides it back. The
// numbers here and the ones there are deliberately the same panel: the two
// halves of one conversion, asserted from both ends.
TEST(DrmScreenTest, APanelsMillimetersCrossAsTheDpiTheyMakeWithTheMode) {
  auto snapshot = SnapshotBuilder()
                      .PhysicalSizeMm(gfx::Size(597, 336))
                      .NativeMode(gfx::Size(1920, 1080), 60.f)
                      .Build();

  const display::Display display = DisplayFromSnapshot(*snapshot, snapshot->origin());

  // 1920 pixels across 597mm is 81.7 per inch, and 1080 across 336mm is 81.6.
  // Per axis rather than one number for both: a panel is not obliged to have
  // square pixels, and a single DPI would make one of the two millimeter
  // figures come back wrong.
  EXPECT_NEAR(display.GetPixelsPerInchX(), 81.688f, 0.001f);
  EXPECT_NEAR(display.GetPixelsPerInchY(), 81.643f, 0.001f);
}

// What the CRTC is running at, which on a tty is the only reading of it there
// is -- the compositor holds no card node and has no mode of its own to
// report.
TEST(DrmScreenTest, ADisplayTakesItsRefreshRateFromTheNativeMode) {
  auto snapshot =
      SnapshotBuilder().NativeMode(gfx::Size(2560, 1440), 143.998f).Build();

  EXPECT_FLOAT_EQ(DisplayFromSnapshot(*snapshot, snapshot->origin()).display_frequency(), 143.998f);
}

// A projector and a virtual output report no physical size at all, and that is
// an ordinary reading rather than a broken one. There is no DPI to compute
// from it and none is invented: zero is what display::Display means by "nobody
// said", and wl_output says the same thing with the same number.
TEST(DrmScreenTest, AConnectorWithNoPhysicalSizeIsGivenNoDensity) {
  auto snapshot = SnapshotBuilder().PhysicalSizeMm(gfx::Size()).Build();

  const display::Display display = DisplayFromSnapshot(*snapshot, snapshot->origin());

  EXPECT_EQ(display.GetPixelsPerInchX(), 0.f);
  EXPECT_EQ(display.GetPixelsPerInchY(), 0.f);
}

// The other half of the same rule: a connector with no mode has no rate, and
// no density either -- a DPI needs both numbers and this one has only the
// millimeters. Its bounds are still the displayless fallback, because a window
// has to land somewhere; a density does not.
TEST(DrmScreenTest, AConnectorWithNoModeHasNeitherARateNorADensity) {
  auto snapshot = SnapshotBuilder()
                      .PhysicalSizeMm(gfx::Size(597, 336))
                      .NoNativeMode()
                      .Build();

  const display::Display display = DisplayFromSnapshot(*snapshot, snapshot->origin());

  EXPECT_EQ(display.display_frequency(), 0.f);
  EXPECT_EQ(display.GetPixelsPerInchX(), 0.f);
}

TEST(DrmScreenTest, ASnapshotWithNoNativeModeStillProducesAUsableDisplay) {
  auto snapshot = SnapshotBuilder().Id(3).NoNativeMode().Build();

  const display::Display display = DisplayFromSnapshot(*snapshot, snapshot->origin());

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
  // `VectorExperimental`, and it has to be spelled: `raw_ptr<T>` and
  // `raw_ptr<T, VectorExperimental>` are different types and vectors of them do
  // not convert. This line said `raw_ptr<T>` from the day `DrmScreen` took the
  // vector traits `GetDisplaysCallback` uses, and nothing noticed, because
  // nothing in the pull-request path compiled this file until the job that
  // found it.
  const std::vector<display::Display> displays = DisplaysFromSnapshots(
      std::vector<raw_ptr<display::DisplaySnapshot, VectorExperimental>>(), {});

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

// Where `id` ended up, for the tests that care about a display's corner and
// not about where it sits in the list.
gfx::Rect BoundsOf(const DrmScreen& screen, int64_t id) {
  for (const display::Display& display : screen.GetAllDisplays()) {
    if (display.id() == id) {
      return display.bounds();
    }
  }
  ADD_FAILURE() << "no display " << id << " in the list";
  return gfx::Rect();
}

TEST(DrmScreenTest, TheFirstSnapshotIsThePrimaryDisplay) {
  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(SnapshotBuilder().Id(11).Build());
  snapshots.push_back(
      SnapshotBuilder().Id(12).Origin(gfx::Point(1920, 0)).Build());

  screen.OnDisplaysChanged(Pointers(snapshots), {});

  EXPECT_EQ(screen.GetAllDisplays().size(), 2u);
  EXPECT_EQ(screen.GetPrimaryDisplay().id(), 11);
}

// THE DIFFERENCE BETWEEN A DESKTOP AND A BLACK SCREEN. A profile that turns
// the laptop panel off is the ordinary case on a full desk -- it is how
// shutting the lid still matches the desk's profile -- and the panel is
// usually the connector the card enumerated first. A browser whose primary
// display is dark comes up drawing correctly onto a screen nobody can see,
// with every log line saying the modeset succeeded.
TEST(DrmScreenTest, ThePrimaryIsTheFirstDisplayTheLayoutLights) {
  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(SnapshotBuilder().Id(11).Build());
  snapshots.push_back(SnapshotBuilder().Id(12).Build());

  screen.OnDisplaysChanged(
      Pointers(snapshots),
      {{.id = 11, .enabled = false, .origin = gfx::Point(1920, 0)},
       {.id = 12, .enabled = true, .origin = gfx::Point(0, 0)}});

  EXPECT_EQ(screen.GetPrimaryDisplay().id(), 12);
}

// THE CRASH THE TEST ABOVE FOUND, pinned so it cannot come back.
// `DisplayList::AddDisplay` reads "the first display must be primary" and
// DCHECKs it, and this build is `dcheck_always_on` -- so a list filled in
// snapshot order with the primary somewhere in the middle took the browser
// down on the FIRST reading. Not on a hotplug, where the list is no longer
// empty, which is the sort of difference a desk does not show you.
//
// It is also what the display event's mojom says arrives: the whole list,
// primary first. That was true by accident until a layout could move the
// primary off snapshot zero.
TEST(DrmScreenTest, TheListArrivesPrimaryFirst) {
  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(SnapshotBuilder().Id(11).Build());
  snapshots.push_back(SnapshotBuilder().Id(12).Build());

  screen.OnDisplaysChanged(
      Pointers(snapshots),
      {{.id = 11, .enabled = false, .origin = gfx::Point(1920, 0)},
       {.id = 12, .enabled = true, .origin = gfx::Point(0, 0)}});

  ASSERT_EQ(screen.GetAllDisplays().size(), 2u);
  EXPECT_EQ(screen.GetAllDisplays().front().id(), 12);
}

TEST(DrmScreenTest, WithNoLayoutThePrimaryIsStillTheFirstDisplay) {
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(SnapshotBuilder().Id(11).Build());
  snapshots.push_back(SnapshotBuilder().Id(12).Build());

  EXPECT_EQ(PrimaryIndexForLayout(Pointers(snapshots), {}), 0u);
}

// A dark connector is still a connector the browser has to place somewhere,
// and leaving it where the CARD stacked it is how two displays end up claiming
// one rectangle. The first of those wins every lookup GetDisplayMatching
// makes, including the one that sizes a fullscreen window.
TEST(DrmScreenTest, ADisplayTakesTheCornerTheLayoutGivesIt) {
  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);
  std::vector<std::unique_ptr<display::DisplaySnapshot>> snapshots;
  snapshots.push_back(SnapshotBuilder()
                          .Id(11)
                          .Origin(gfx::Point(0, 0))
                          .NativeMode(gfx::Size(2880, 1920), 120.f)
                          .Build());
  snapshots.push_back(SnapshotBuilder()
                          .Id(12)
                          .Origin(gfx::Point(0, 0))
                          .NativeMode(gfx::Size(3840, 2160), 60.f)
                          .Build());

  screen.OnDisplaysChanged(
      Pointers(snapshots),
      {{.id = 11, .enabled = false, .origin = gfx::Point(3840, 0)},
       {.id = 12, .enabled = true, .origin = gfx::Point(0, 0)}});

  // By id rather than by position: the list arrives primary first, which is
  // the lit one here, so an index would be asserting the order rather than
  // the corners. `TheListArrivesPrimaryFirst` is what asserts the order.
  ASSERT_EQ(screen.GetAllDisplays().size(), 2u);
  EXPECT_EQ(BoundsOf(screen, 11), gfx::Rect(3840, 0, 2880, 1920))
      << "the dark panel is placed out of the lit one's way";
  EXPECT_EQ(BoundsOf(screen, 12), gfx::Rect(0, 0, 3840, 2160));
}

// What OzonePlatformDrm::InitScreen does before the modeset driver has run,
// and what every connector on crux reports besides.
TEST(DrmScreenTest, AScreenToldOfNoDisplaysStillAnswersWithAPrimary) {
  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);

  screen.OnDisplaysChanged({}, {});

  EXPECT_FALSE(screen.GetPrimaryDisplay().bounds().IsEmpty());
}

// A hotplug is a whole new list rather than a delta, so the display that left
// has to leave the list with it.
TEST(DrmScreenTest, AHotplugReplacesTheListRatherThanAppendingToIt) {
  DrmWindowHostManager window_manager;
  DrmScreen screen(&window_manager);
  std::vector<std::unique_ptr<display::DisplaySnapshot>> unplugged;
  unplugged.push_back(SnapshotBuilder().Id(11).Build());
  screen.OnDisplaysChanged(Pointers(unplugged), {});
  std::vector<std::unique_ptr<display::DisplaySnapshot>> plugged;
  plugged.push_back(SnapshotBuilder().Id(12).Build());

  screen.OnDisplaysChanged(Pointers(plugged), {});

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

  screen.OnDisplaysChanged(Pointers(snapshots), {});

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
  screen.OnDisplaysChanged(Pointers(snapshots), {});

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
  screen.OnDisplaysChanged(Pointers(snapshots), {});

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
  screen.OnDisplaysChanged(Pointers(snapshots), {});

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
