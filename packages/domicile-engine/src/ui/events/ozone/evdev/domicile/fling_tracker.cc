// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/ozone/evdev/domicile/fling_tracker.h"

namespace ui {

namespace {

// Several of any pad's reports, short enough to be the flick and not the
// drag before it.
constexpr base::TimeDelta kWindow = base::Milliseconds(100);
// Fingers still this long before lifting were placing the page, not flicking.
constexpr base::TimeDelta kRestBeforeLift = base::Milliseconds(100);

}  // namespace

FlingTracker::FlingTracker() = default;

FlingTracker::~FlingTracker() = default;

void FlingTracker::Scroll(const gfx::Vector2dF& delta, base::TimeTicks time) {
  samples_.push_back({delta, time});
  while (time - samples_.front().time > kWindow) {
    samples_.pop_front();
  }
}

gfx::Vector2dF FlingTracker::Release(base::TimeTicks time) {
  if (samples_.size() < 2 || samples_.front().time == samples_.back().time ||
      time - samples_.back().time > kRestBeforeLift) {
    samples_.clear();
    return gfx::Vector2dF();
  }
  // The first sample marks when the window starts; its distance was covered
  // before it.
  gfx::Vector2dF distance;
  for (size_t i = 1; i < samples_.size(); ++i) {
    distance += samples_[i].delta;
  }
  const double seconds =
      (samples_.back().time - samples_.front().time).InSecondsF();
  samples_.clear();
  return gfx::ScaleVector2d(distance, 1 / seconds);
}

}  // namespace ui
