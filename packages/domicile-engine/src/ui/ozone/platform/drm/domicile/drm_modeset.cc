// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_modeset.h"

#include <stddef.h>
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
#include "ui/gfx/geometry/point.h"
#include "ui/ozone/platform/drm/domicile/drm_screen.h"

namespace ui {
namespace {

// Returns `layout`'s entry for connector `id`, or `nullptr` if it has none.
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
  // Shared with the display list so both agree on each display's origin.
  const std::vector<gfx::Point> origins = OriginsForLayout(snapshots, layout);
  std::vector<display::DisplayConfigurationParams> params;
  params.reserve(snapshots.size());
  for (size_t index = 0; index < snapshots.size(); ++index) {
    const display::DisplaySnapshot* snapshot = snapshots[index];
    const display::DisplayMode* native_mode = snapshot->native_mode();
    if (!native_mode) {
      // No advertised mode, so none is invented. See the header.
      continue;
    }
    const DomicileDisplayLayout* wanted =
        layout.empty() ? nullptr : WantedFor(layout, snapshot->display_id());
    if (!layout.empty() && (!wanted || !wanted->enabled)) {
      // Turned off by the compositor, or not in its layout yet.
      continue;
    }
    // Pass the mode borrowed: the params constructor clones it, so cloning
    // here too would leak a DisplayMode per display on every hotplug.
    params.emplace_back(snapshot->display_id(), origins[index], native_mode);
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
    // Whole hertz is precise enough for a log line.
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
  // Re-read the displays; see the header.
  delegate_->GetDisplays(
      base::BindOnce(&DrmModeset::OnDisplaysReceived, base::Unretained(this)));
}

void DrmModeset::Relight() {
  // The confirmation from before a resume or VT switch no longer describes
  // the hardware. See the header.
  confirmed_.clear();
  delegate_->GetDisplays(
      base::BindOnce(&DrmModeset::OnDisplaysReceived, base::Unretained(this)));
}

void DrmModeset::OnConfigurationChanged() {
  // A hotplug. Re-read so the screen and modeset share one reading.
  delegate_->GetDisplays(
      base::BindOnce(&DrmModeset::OnDisplaysReceived, base::Unretained(this)));
}

void DrmModeset::OnDisplaySnapshotsInvalidated() {
  // Nothing to drop: `OnDisplaysReceived` keeps no snapshots.
}

bool ModesetWouldChangeAnything(
    const std::vector<display::DisplayConfigurationParams>& asked,
    const std::vector<display::DisplayConfigurationParams>& wanted) {
  // `operator==` compares every field a modeset request carries.
  return asked != wanted;
}

void DrmModeset::OnDisplaysReceived(
    const std::vector<raw_ptr<display::DisplaySnapshot,
                              VectorExperimental>>& snapshots) {
  // Log every reading, including its modes. See `DescribeSnapshots`.
  VLOG(1) << "domicile: DRM reports " << DescribeSnapshots(snapshots);

  // Update the screen first: a window needs somewhere to land even if the
  // modeset fails.
  screen_->OnDisplaysChanged(snapshots, layout_);

  std::vector<display::DisplayConfigurationParams> params =
      ModesetParamsFromSnapshots(snapshots, layout_);
  if (params.empty()) {
    // Not an error: a machine with no panel reports this. The compositor
    // rejects a layout that turns every connector off.
    VLOG(1) << "domicile: nothing readable is plugged in; not modesetting";
    return;
  }

  if (!ModesetWouldChangeAnything(confirmed_, params)) {
    // The CRTCs already match. This is usually the udev CHANGE from our own
    // last modeset.
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
              // Not recorded: only a confirmed modeset is compared against.
              // See `ModesetWouldChangeAnything`.
              LOG(ERROR) << "domicile: the DRM thread refused the modeset; the "
                            "displays it reported are connected but nothing is "
                            "lit";
              return;
            }
            if (!self) {
              return;
            }
            if (self->inside_configure_) {
              // Answered before `Configure` returned, so no hardware saw it.
              // `Start()` runs before the GPU process exists, and
              // `DrmDisplayHostManager` answers from its dummy snapshots
              // synchronously. Recording this would make the first real
              // reading look like a repeat, so a machine whose dummy reading
              // matches its real one would never modeset.
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
