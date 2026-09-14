// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_MODESET_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_MODESET_H_

#include <memory>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "ui/display/types/display_configuration_params.h"
#include "ui/display/types/native_display_delegate.h"
#include "ui/display/types/native_display_observer.h"

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
std::vector<display::DisplayConfigurationParams> ModesetParamsFromSnapshots(
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
// Compared against what was last ASKED FOR rather than what last succeeded, on
// purpose. A refused modeset leaves the hardware in a state this process did
// not choose and cannot read back, so retrying the identical request is the
// one thing guaranteed not to help -- and it is how the loop comes back for
// the failure case.
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

  // display::NativeDisplayObserver:
  void OnConfigurationChanged() override;
  void OnDisplaySnapshotsInvalidated() override;

 private:
  void OnDisplaysReceived(
      const std::vector<raw_ptr<display::DisplaySnapshot,
                                VectorExperimental>>& snapshots);

  const std::unique_ptr<display::NativeDisplayDelegate> delegate_;
  const raw_ptr<DrmScreen> screen_;  // Not owned; outlives this.
  // What was last asked for, so a hotplug this driver caused is not answered
  // with the modeset that caused it. See `ModesetWouldChangeAnything`.
  std::vector<display::DisplayConfigurationParams> asked_;
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_MODESET_H_
