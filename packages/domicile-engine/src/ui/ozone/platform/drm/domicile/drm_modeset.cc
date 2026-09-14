// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_modeset.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/logging.h"
#include "ui/display/types/display_constants.h"
#include "ui/display/types/display_mode.h"
#include "ui/display/types/display_snapshot.h"
#include "ui/ozone/platform/drm/domicile/drm_screen.h"

namespace ui {

std::vector<display::DisplayConfigurationParams> ModesetParamsFromSnapshots(
    const std::vector<raw_ptr<display::DisplaySnapshot,
                              VectorExperimental>>& snapshots) {
  std::vector<display::DisplayConfigurationParams> params;
  params.reserve(snapshots.size());
  for (const auto& snapshot : snapshots) {
    const display::DisplayMode* native_mode = snapshot->native_mode();
    if (!native_mode) {
      // Connected and unreadable. See the header: a connector that advertised
      // no mode gets none invented for it.
      continue;
    }
    // The mode is passed as a borrowed pointer: DisplayConfigurationParams'
    // constructor clones it into its own `mode`, so cloning here as well would
    // leak one DisplayMode per display on every hotplug.
    params.emplace_back(snapshot->display_id(), snapshot->origin(),
                        native_mode);
  }
  return params;
}

DrmModeset::DrmModeset(
    std::unique_ptr<display::NativeDisplayDelegate> delegate,
    DrmScreen* screen)
    : delegate_(std::move(delegate)), screen_(screen) {}

DrmModeset::~DrmModeset() {
  delegate_->RemoveObserver(this);
}

void DrmModeset::Start() {
  delegate_->AddObserver(this);
  delegate_->Initialize();
  delegate_->GetDisplays(
      base::BindOnce(&DrmModeset::OnDisplaysReceived, base::Unretained(this)));
}

void DrmModeset::OnConfigurationChanged() {
  // A hotplug. Read the list again and light whatever is there now; the two
  // must come from one reading, which is why this does not reuse the last one.
  delegate_->GetDisplays(
      base::BindOnce(&DrmModeset::OnDisplaysReceived, base::Unretained(this)));
}

void DrmModeset::OnDisplaySnapshotsInvalidated() {
  // The snapshots this holds pointers to are about to be destroyed. It holds
  // none between callbacks -- `OnDisplaysReceived` consumes them and keeps
  // nothing -- so there is nothing to drop here, and saying so is worth more
  // than an empty body with no comment.
}

bool ModesetWouldChangeAnything(
    const std::vector<display::DisplayConfigurationParams>& asked,
    const std::vector<display::DisplayConfigurationParams>& wanted) {
  // `DisplayConfigurationParams::operator==` compares the id, the origin, the
  // mode and the VRR flag, which is every field a modeset request carries. So
  // equal vectors are the same request, and the same request against an
  // unchanged report is the loop.
  return asked != wanted;
}

void DrmModeset::OnDisplaysReceived(
    const std::vector<raw_ptr<display::DisplaySnapshot,
                              VectorExperimental>>& snapshots) {
  // The screen first: a window needs somewhere to land whether or not the
  // modeset succeeds, and `DrmScreen` answers for an empty list by design.
  screen_->OnDisplaysChanged(snapshots);

  std::vector<display::DisplayConfigurationParams> params =
      ModesetParamsFromSnapshots(snapshots);
  if (params.empty()) {
    // Nothing readable is plugged in. Not an error: it is what every connector
    // on a machine with no panel reports, and `DrmScreen` has already been told.
    return;
  }

  if (!ModesetWouldChangeAnything(asked_, params)) {
    // Almost certainly a hotplug this driver caused by answering the last one.
    // Nothing is wrong and nothing is skipped: the screen has already been
    // told, and the CRTCs are being asked for the modes they already have.
    VLOG(1) << "domicile: the displays read the same as last time; not "
               "modesetting again";
    return;
  }
  asked_ = params;

  delegate_->Configure(
      params,
      base::BindOnce([](const std::vector<display::DisplayConfigurationParams>&,
                        bool status) {
        // Loud and no recovery, because there is none to attempt here: the
        // modes came from the hardware's own report, so a refusal is a fact
        // about the hardware or the master, not something a retry changes.
        LOG_IF(ERROR, !status)
            << "domicile: the DRM thread refused the modeset; the displays it "
               "reported are connected but nothing is lit";
      }),
      {display::ModesetFlag::kCommitModeset});
}

}  // namespace ui
