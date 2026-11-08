// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/events/domicile/edge_swipe.h"

#include <algorithm>
#include <cmath>
#include <utility>

#include "base/notreached.h"

#include "ui/events/domicile/native_gesture_sink.h"

namespace ui {

EdgeSwipe::EdgeSwipe() = default;
EdgeSwipe::~EdgeSwipe() = default;

EdgeSwipe::Verdict EdgeSwipe::Touch(EventType type,
                                    int slot,
                                    const gfx::PointF& location,
                                    const gfx::RectF& display,
                                    base::TimeTicks time) {
  const bool lifted =
      type == EventType::kTouchReleased || type == EventType::kTouchCancelled;
  if (type == EventType::kTouchPressed &&
      std::ranges::find(down_, slot) == down_.end()) {
    down_.push_back(slot);
  }
  Verdict verdict = Verdict::kDispatch;
  switch (state_) {
    case State::kIdle: {
      if (type != EventType::kTouchPressed) {
        break;
      }
      const std::optional<NativeGestureEdge> edge = EdgeAt(location, display);
      NativeGestureSink* sink = NativeGestureSink::Get();
      if (edge && sink &&
          sink->Takes({.kind = NativeGestureKind::kEdge,
                       .phase = NativeGesturePhase::kBegin,
                       .fingers = 1,
                       .edge = edge})) {
        state_ = State::kDeciding;
        slot_ = slot;
        edge_ = *edge;
        display_ = display;
        start_ = location;
        last_ = location;
        deadline_ = time + kEdgeSwipeWait;
        verdict = Verdict::kWithhold;
      } else {
        state_ = State::kPage;
      }
      break;
    }
    case State::kDeciding:
      if (slot == slot_) {
        verdict = Decide(type, location);
      } else if (type == EventType::kTouchPressed) {
        // Two fingers are a pinch or a scroll, not a swipe from the edge.
        state_ = State::kPage;
        deadline_.reset();
        verdict = Verdict::kRelease;
      }
      break;
    case State::kSwiping:
      if (slot == slot_) {
        verdict = Swipe(type, location);
      }
      break;
    case State::kPage:
      break;
  }
  if (lifted) {
    std::erase(down_, slot);
    if (down_.empty()) {
      state_ = State::kIdle;
      deadline_.reset();
    }
  }
  return verdict;
}

void EdgeSwipe::Expire() {
  if (state_ == State::kDeciding) {
    state_ = State::kPage;
    deadline_.reset();
  }
}

// static
std::optional<NativeGestureEdge> EdgeSwipe::EdgeAt(const gfx::PointF& location,
                                                   const gfx::RectF& display) {
  if (display.IsEmpty()) {
    return std::nullopt;
  }
  const float x = (location.x() - display.x()) / display.width();
  const float y = (location.y() - display.y()) / display.height();
  const std::pair<float, NativeGestureEdge> sides[] = {
      {x, NativeGestureEdge::kLeft},
      {1 - x, NativeGestureEdge::kRight},
      {y, NativeGestureEdge::kTop},
      {1 - y, NativeGestureEdge::kBottom},
  };
  const auto& [away, edge] = *std::ranges::min_element(
      sides, {}, &std::pair<float, NativeGestureEdge>::first);
  if (away < 0 || away > kEdgeSwipeBand) {
    return std::nullopt;
  }
  return edge;
}

gfx::Vector2dF EdgeSwipe::Travel(const gfx::PointF& location) const {
  const gfx::Vector2dF moved = location - start_;
  const float across_x = moved.x() / display_.width();
  const float across_y = moved.y() / display_.height();
  switch (edge_) {
    case NativeGestureEdge::kLeft:
      return {across_x, std::abs(across_y)};
    case NativeGestureEdge::kRight:
      return {-across_x, std::abs(across_y)};
    case NativeGestureEdge::kTop:
      return {across_y, std::abs(across_x)};
    case NativeGestureEdge::kBottom:
      return {-across_y, std::abs(across_x)};
  }
  NOTREACHED();
}

EdgeSwipe::Verdict EdgeSwipe::Decide(EventType type,
                                     const gfx::PointF& location) {
  if (type != EventType::kTouchMoved) {
    // A tap at the edge, or a finger the platform took back, is the page's.
    if (type == EventType::kTouchPressed) {
      return Verdict::kWithhold;
    }
    state_ = State::kPage;
    deadline_.reset();
    return Verdict::kRelease;
  }
  last_ = location;
  const gfx::Vector2dF travel = Travel(location);
  const float in = travel.x();
  const float along = travel.y();
  if (in >= kEdgeSwipeDistance && in > along) {
    state_ = State::kSwiping;
    deadline_.reset();
    Tell(NativeGesturePhase::kBegin, {}, false);
    Tell(NativeGesturePhase::kUpdate, location - start_, false);
    return Verdict::kTaken;
  }
  if (along >= kEdgeSwipeDistance || -in >= kEdgeSwipeBand) {
    state_ = State::kPage;
    deadline_.reset();
    return Verdict::kRelease;
  }
  return Verdict::kWithhold;
}

EdgeSwipe::Verdict EdgeSwipe::Swipe(EventType type,
                                    const gfx::PointF& location) {
  switch (type) {
    case EventType::kTouchMoved:
      Tell(NativeGesturePhase::kUpdate, location - last_, false);
      last_ = location;
      break;
    case EventType::kTouchReleased:
    case EventType::kTouchCancelled:
      Tell(NativeGesturePhase::kEnd, {}, type == EventType::kTouchCancelled);
      // Any other finger still down stays the page's.
      state_ = State::kPage;
      break;
    default:
      break;
  }
  return Verdict::kTaken;
}

void EdgeSwipe::Tell(NativeGesturePhase phase,
                     const gfx::Vector2dF& motion,
                     bool canceled) {
  NativeGestureSink* sink = NativeGestureSink::Get();
  if (!sink) {
    return;
  }
  sink->Take({.kind = NativeGestureKind::kEdge,
              .phase = phase,
              .fingers = 1,
              .dx = motion.x(),
              .dy = motion.y(),
              .canceled = canceled,
              .edge = edge_});
}

}  // namespace ui
