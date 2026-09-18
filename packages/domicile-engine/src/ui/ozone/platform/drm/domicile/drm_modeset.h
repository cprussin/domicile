// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_MODESET_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_MODESET_H_

#include <memory>
#include <string>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "ui/display/types/display_configuration_params.h"
#include "ui/display/types/native_display_delegate.h"
#include "ui/display/types/native_display_observer.h"
#include "ui/ozone/public/ozone_platform.h"

namespace display {
class DisplaySnapshot;
}

namespace ui {

class DrmScreen;

// What to ask the DRM thread to light, given what it reported is connected.
//
// This is the whole of the arithmetic in lighting a screen, and it is a free
// function so that it has a test: everything around it -- a delegate, two
// asynchronous callbacks and a thread -- is wiring, and wiring is what the
// browser exercises.
//
// A snapshot with no native mode is SKIPPED rather than given a fallback. That
// is the opposite of what `DisplaysFromSnapshots` does with the same input, and
// deliberately: a display list must answer for every connector because a window
// has to land somewhere, while a modeset must not invent a mode for a connector
// that did not report one. Asking a CRTC for a mode the hardware never
// advertised is how a screen goes black rather than wrong.
//
// `layout` IS THE COMPOSITOR'S ANSWER ABOUT WHAT THE GLASS DOES, and it is the
// whole of why this takes two arguments. The config that says which monitors
// are on and which side of the desk each is on lives in the compositor; the
// CRTCs live here, because this is the process holding DRM master. So the
// answer crosses the engine's C ABI and arrives as this.
//
// EMPTY MEANS THE HARDWARE DECIDES, which is what every desktop but a matched
// profile's says and what this did before a layout could be stated at all:
// every readable connector, at the origin the card stacked it at.
//
// A NON-EMPTY LAYOUT IS THE WHOLE TRUTH. A connector it does not name is left
// dark rather than lit where the card put it, because an origin nothing chose
// can land on top of one that was chosen -- and two controllers claiming one
// rectangle is the exact-rect mismatch `ScreenManager::FindWindowAt` answers
// by binding no window at all. That case is a monitor plugged in between the
// reading the compositor answered and this one, and it lights on the next
// round trip: this modeset makes the kernel emit a CHANGE, the display list
// crosses again, and the answer that comes back names it.
std::vector<display::DisplayConfigurationParams> ModesetParamsFromSnapshots(
    const std::vector<raw_ptr<display::DisplaySnapshot,
                              VectorExperimental>>& snapshots,
    const std::vector<DomicileDisplayLayout>& layout);

// What a reading of the displays says, in one line.
//
// THIS EXISTS BECAUSE THREE RUNS ON REAL HARDWARE WERE SPENT INFERRING WHAT
// THIS DRIVER DID. It logged when it SKIPPED a modeset and said nothing at all
// when it performed one, so a successful modeset was invisible unless
// Chromium's own `screen_manager` VLOG was enabled -- and
// `--vmodule=drm*=1,gbm*=1,ozone*=1`, the incantation everybody was using,
// does not match `screen_manager`. Absence of evidence read as evidence of
// absence, twice.
//
// The mode is the load-bearing part. It is what the CRTC is set to, and it is
// what the browser window has to match EXACTLY -- `ScreenManager::FindWindowAt`
// compares whole rectangles -- or no controller is bound to the window and
// every page flip is dropped before it reaches the kernel.
//
// A free function so it has a test, like the two below.
std::string DescribeSnapshots(
    const std::vector<raw_ptr<display::DisplaySnapshot,
                              VectorExperimental>>& snapshots);

// Whether asking for `wanted` could tell us anything `asked` did not.
//
// THIS EXISTS BECAUSE THE FIRST RUN ON REAL HARDWARE MODESET FOREVER. Every
// `Configure` makes the kernel emit a udev CHANGE for the card; the browser
// process turns that into `OnConfigurationChanged`; this driver read the
// displays and configured them again. The log from that machine is a CRTC
// being set to the mode it was already in, over and over, seconds apart --
// and a screen re-modesetting on a loop is a screen that never settles enough
// to show anything. The driver caused its own hotplugs.
//
// The rule that breaks it is one sentence: the params come from the hardware's
// own report, so if the report has not changed, asking again cannot produce a
// different answer. A real hotplug changes the report and always gets through.
//
// Compared against what the hardware last CONFIRMED, and the first attempt at
// this compared against what was last asked for instead. That was wrong, and
// wrong in a way that showed up only on a real machine: the driver's first
// `Configure` goes out before the GPU thread has added a DRM device, so it
// reaches nothing. Recording it anyway made the guard suppress the udev ADD
// that arrives three seconds later with the same reading -- and the second ask
// was the one that would have worked. Nothing modeset at all.
//
// So an ask that was never confirmed is not a state anything can be compared
// to. The old code got away with it by re-configuring on every event, which is
// the loop; the rule is the same one, applied to the right fact.
bool ModesetWouldChangeAnything(
    const std::vector<display::DisplayConfigurationParams>& asked,
    const std::vector<display::DisplayConfigurationParams>& wanted);

// Drives `NativeDisplayDelegate` so that something actually modesets.
//
// On ChromeOS this is `DisplayConfigurator`, which lives in
// `//ui/display/manager` behind `assert(is_chromeos)`. Only that CALLER is
// ChromeOS-only: every seam it drives -- `GetDisplays`, `Configure`,
// `TakeDisplayControl` -- is ungated and already implemented by
// `DrmNativeDisplayDelegate`. So this is a caller, not a port, and it skips
// `DisplayChangeObserver` entirely: those 478 lines produce
// `ManagedDisplayInfo`, which is ChromeOS product surface nothing here reads.
//
// It feeds `DrmScreen` the same snapshots it modesets from, so the display list
// the browser sees and the CRTCs that are lit come from one reading.
class DrmModeset : public display::NativeDisplayObserver {
 public:
  DrmModeset(std::unique_ptr<display::NativeDisplayDelegate> delegate,
             DrmScreen* screen);

  DrmModeset(const DrmModeset&) = delete;
  DrmModeset& operator=(const DrmModeset&) = delete;

  ~DrmModeset() override;

  // Initializes the delegate and asks for the display list. Lighting happens
  // when that answer arrives, and again on every hotplug.
  void Start();

  // What the compositor wants the connectors doing. See
  // `ModesetParamsFromSnapshots`, which is where it is applied.
  //
  // Re-reads the displays rather than reusing the last reading, for the reason
  // `OnConfigurationChanged` does: this holds no snapshots between callbacks --
  // they are owned by the host manager and `OnDisplaySnapshotsInvalidated` is
  // how it says so -- and the two halves of an answer must come from one
  // reading whichever of them moved.
  void SetLayout(std::vector<DomicileDisplayLayout> layout);

  // display::NativeDisplayObserver:
  void OnConfigurationChanged() override;
  void OnDisplaySnapshotsInvalidated() override;

 private:
  void OnDisplaysReceived(
      const std::vector<raw_ptr<display::DisplaySnapshot,
                                VectorExperimental>>& snapshots);

  const std::unique_ptr<display::NativeDisplayDelegate> delegate_;
  const raw_ptr<DrmScreen> screen_;  // Not owned; outlives this.
  // What the hardware last CONFIRMED, so a hotplug this driver caused is not
  // answered with the modeset that caused it -- and so an ask that reached
  // nothing is not mistaken for one that landed. See
  // `ModesetWouldChangeAnything`.
  std::vector<display::DisplayConfigurationParams> confirmed_;
  // What the compositor last said the connectors should be doing, empty until
  // it has said anything. See `ModesetParamsFromSnapshots`.
  std::vector<DomicileDisplayLayout> layout_;
  // Whether control is still inside `delegate_->Configure`, which is how a
  // yes that reached hardware is told from one that did not: a real modeset is
  // committed on the DRM thread and answered on a later task, so the only
  // thing that can answer before the call returns is this process itself. See
  // `OnDisplaysReceived`.
  bool inside_configure_ = false;
  base::WeakPtrFactory<DrmModeset> weak_factory_{this};
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_MODESET_H_
