// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/shell_windows.h"

#include <algorithm>
#include <utility>

namespace domicile {
namespace {

// Whether `id` is one of `ids`. `base::Contains` is what this would have been;
// `base/containers/contains.h` is gone from the tree at our pin, and
// `std::ranges::find` is what the tree reaches for in its place -- the same
// substitution `shortcut_registry.h` records for the same reason.
bool Holds(const std::vector<int64_t>& ids, int64_t id) {
  return std::ranges::find(ids, id) != ids.end();
}

}  // namespace

ShellWindowPlan ShellWindowsFor(const std::vector<display::Display>& displays,
                                const std::vector<int64_t>& windowed) {
  ShellWindowPlan plan;
  for (const display::Display& display : displays) {
    if (!Holds(windowed, display.id())) {
      plan.open.push_back(display.id());
    }
  }
  for (int64_t held : windowed) {
    // A linear scan each way rather than a set built first: a desk is a
    // handful of monitors, and the set would cost more to build than it saves.
    const bool still_here =
        std::ranges::any_of(displays, [held](const display::Display& display) {
          return display.id() == held;
        });
    if (!still_here) {
      plan.close.push_back(held);
    }
  }
  // The last window is kept when nothing is opening to replace it. Closing it
  // is the browser exiting and the desktop ending -- see the header -- and the
  // case is an ordinary one: a lid shut on a laptop with nothing plugged in
  // reports no displays at all.
  if (plan.open.empty() && plan.close.size() == windowed.size() &&
      !windowed.empty()) {
    plan.close.erase(plan.close.begin());
  }
  return plan;
}

ShellWindowPlaces::ShellWindowPlaces() = default;

ShellWindowPlaces::~ShellWindowPlaces() = default;

void ShellWindowPlaces::Place(uintptr_t window, int64_t display) {
  placed_.insert_or_assign(window, display);
}

std::vector<int64_t> ShellWindowPlaces::Update(
    const std::vector<SightedShellWindow>& live) {
  base::flat_map<uintptr_t, int64_t> still_here;
  std::vector<int64_t> windowed;
  windowed.reserve(live.size());
  for (const SightedShellWindow& one : live) {
    // The record wins where there is one, which is the whole point: a window
    // that has been seen is on the display it was seen on, whatever its
    // rectangle reads as in the middle of a hotplug.
    const auto known = placed_.find(one.window);
    const int64_t on = known == placed_.end() ? one.nearest : known->second;
    still_here.insert_or_assign(one.window, on);
    windowed.push_back(on);
  }
  // Assigned rather than merged, so a window the browser no longer has is
  // gone from here too.
  placed_ = std::move(still_here);
  return windowed;
}

int64_t ShellWindowPlaces::Of(uintptr_t window) const {
  const auto known = placed_.find(window);
  return known == placed_.end() ? display::kInvalidDisplayId : known->second;
}

}  // namespace domicile
