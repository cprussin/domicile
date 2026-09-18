// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_modeset.h"

#include <stdint.h>

#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "ui/display/types/display_constants.h"
#include "ui/display/types/display_mode.h"
#include "ui/display/types/display_snapshot.h"
#include "ui/ozone/platform/drm/domicile/drm_screen.h"

namespace ui {
namespace {

// What `layout` says about the connector `id`, or nothing where it is silent.
//
// A pointer into the caller's vector rather than a copy, and `nullptr` for the
// two cases the caller tells apart itself: a layout that says nothing about
// anything, and one that says nothing about this connector.
const DomicileDisplayLayout* WantedFor(
    const std::vector<DomicileDisplayLayout>& layout,
    int64_t id) {
  for (const DomicileDisplayLayout& wanted : layout) {
    if (wanted.id == id) {
      return &wanted;
    }
  }
  return nullptr;
}

}  // namespace

std::vector<display::DisplayConfigurationParams> ModesetParamsFromSnapshots(
    const std::vector<raw_ptr<display::DisplaySnapshot,
                              VectorExperimental>>& snapshots,
    const std::vector<DomicileDisplayLayout>& layout) {
  std::vector<display::DisplayConfigurationParams> params;
  params.reserve(snapshots.size());
  for (const auto& snapshot : snapshots) {
    const display::DisplayMode* native_mode = snapshot->native_mode();
    if (!native_mode) {
      // Connected and unreadable. See the header: a connector that advertised
      // no mode gets none invented for it, whatever a layout says about where
      // it goes.
      continue;
    }
    const DomicileDisplayLayout* wanted =
        layout.empty() ? nullptr : WantedFor(layout, snapshot->display_id());
    if (!layout.empty() && (!wanted || !wanted->enabled)) {
      // Dark: either the compositor turned this connector off, or it has not
      // heard of it yet. The header argues why the second is not lit where the
      // card put it.
      continue;
    }
    // The mode is passed as a borrowed pointer: DisplayConfigurationParams'
    // constructor clones it into its own `mode`, so cloning here as well would
    // leak one DisplayMode per display on every hotplug.
    params.emplace_back(snapshot->display_id(),
                        wanted ? wanted->origin : snapshot->origin(),
                        native_mode);
  }
  return params;
}

std::string DescribeSnapshots(
    const std::vector<raw_ptr<display::DisplaySnapshot,
                              VectorExperimental>>& snapshots) {
  std::vector<std::string> described;
  described.reserve(snapshots.size());
  for (const display::DisplaySnapshot* snapshot : snapshots) {
    const display::DisplayMode* native_mode = snapshot->native_mode();
    // Truncated to whole hertz: this is a log line, and 119.88 tells nobody
    // anything 120 does not.
    const std::string mode =
        native_mode
            ? base::StrCat({native_mode->size().ToString(), "@",
                            base::NumberToString(static_cast<int>(
                                native_mode->refresh_rate()))})
            : std::string("no mode");
    described.push_back(base::StrCat({base::NumberToString(
                                          snapshot->display_id()),
                                      " at ", snapshot->origin().ToString(),
                                      " ", mode}));
  }
  return base::StrCat({base::NumberToString(snapshots.size()),
                       " connector(s)", described.empty() ? "" : ": ",
                       base::JoinString(described, "; ")});
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

void DrmModeset::SetLayout(std::vector<DomicileDisplayLayout> layout) {
  VLOG(1) << "domicile: the compositor wants " << layout.size()
          << " connector(s) laid out its way";
  layout_ = std::move(layout);
  // The displays again, rather than the last reading: this holds no snapshots
  // between callbacks, and the header says why the two halves of an answer
  // come from one reading.
  delegate_->GetDisplays(
      base::BindOnce(&DrmModeset::OnDisplaysReceived, base::Unretained(this)));
}

void DrmModeset::Relight() {
  // The header argues the whole of it: what the hardware confirmed before a
  // sleep is not a state the reading after one can be compared to.
  confirmed_.clear();
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
  // Every reading, whatever is decided about it. This is the line that says
  // what the hardware reported and, crucially, at which mode -- see
  // `DescribeSnapshots`.
  VLOG(1) << "domicile: DRM reports " << DescribeSnapshots(snapshots);

  // The screen first: a window needs somewhere to land whether or not the
  // modeset succeeds, and `DrmScreen` answers for an empty list by design.
  screen_->OnDisplaysChanged(snapshots, layout_);

  std::vector<display::DisplayConfigurationParams> params =
      ModesetParamsFromSnapshots(snapshots, layout_);
  if (params.empty()) {
    // Nothing to light. Not an error: it is what every connector on a machine
    // with no panel reports, and `DrmScreen` has already been told. A layout
    // that turns every connector off cannot get here -- the compositor refuses
    // a profile that leaves no desktop to put a window on -- so this stays the
    // reading it always was.
    VLOG(1) << "domicile: nothing readable is plugged in; not modesetting";
    return;
  }

  if (!ModesetWouldChangeAnything(confirmed_, params)) {
    // A hotplug this driver caused by answering the last one. Nothing is wrong
    // and nothing is skipped: the screen has already been told, and the CRTCs
    // are already in the modes this would ask for.
    VLOG(1) << "domicile: the displays read the same as last time; not "
               "modesetting again";
    return;
  }

  VLOG(1) << "domicile: configuring " << params.size() << " display(s)";
  inside_configure_ = true;
  delegate_->Configure(
      params,
      base::BindOnce(
          [](base::WeakPtr<DrmModeset> self,
             std::vector<display::DisplayConfigurationParams> asked,
             const std::vector<display::DisplayConfigurationParams>&,
             bool status) {
            if (!status) {
              // Loud, and deliberately NOT recorded. An ask that the hardware
              // did not confirm is not a state to compare the next reading
              // against -- the first one this driver sends goes out before the
              // GPU thread has a DRM device to send it to, and remembering
              // that one is how a machine ends up never modesetting at all.
              LOG(ERROR) << "domicile: the DRM thread refused the modeset; the "
                            "displays it reported are connected but nothing is "
                            "lit";
              return;
            }
            if (!self) {
              return;
            }
            if (self->inside_configure_) {
              // A YES THAT NEVER LEFT THIS PROCESS, and it is the one that got
              // through the guard above. `Start()` runs at `InitScreen` time,
              // before a GPU process exists, so `DrmDisplayHostManager` has
              // only the dummy snapshots its constructor built from its own
              // read of the primary card -- and `ConfigureDisplays` reads
              // `is_dummy()` on those and runs this callback with `true`
              // without asking anything. On the machine this was found on, the
              // confirmation was logged three microseconds after the ask.
              //
              // A real modeset is committed on the DRM thread and answered on
              // a later task, so an answer that arrives before `Configure` has
              // returned is by construction one no hardware saw. Recording it
              // would make the first REAL reading look like a repeat, and on a
              // single-card machine whose dummy reading matches its real one
              // nothing would ever modeset.
              VLOG(1) << "domicile: the modeset was answered from inside the "
                         "browser process; no hardware saw it, so it is not a "
                         "confirmation";
              return;
            }
            VLOG(1) << "domicile: the DRM thread confirmed the modeset";
            self->confirmed_ = std::move(asked);
          },
          weak_factory_.GetWeakPtr(), params),
      {display::ModesetFlag::kCommitModeset});
  inside_configure_ = false;
}

}  // namespace ui
