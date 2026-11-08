// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_EVENTS_DOMICILE_EDGE_SWIPE_H_
#define UI_EVENTS_DOMICILE_EDGE_SWIPE_H_

#include <optional>
#include <vector>

#include "base/time/time.h"
#include "ui/events/events_export.h"
#include "ui/events/types/event_type.h"
#include "ui/events/types/native_gesture.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/geometry/vector2d_f.h"

namespace ui {

// How near a display's edge a finger lands to come in from it, and how far in
// it moves to be a swipe, each as a share of the display across that edge.
inline constexpr float kEdgeSwipeBand = 0.03f;
inline constexpr float kEdgeSwipeDistance = 0.06f;

// How long a finger at an edge is withheld before it is the page's after all.
inline constexpr base::TimeDelta kEdgeSwipeWait = base::Milliseconds(250);

// Whether one touchscreen's finger in from its display's edge is the shell's.
//
// A finger landing in the band along an edge the shell binds is withheld from
// the page until it decides:
//
// - It moves in far enough, mostly away from the edge: an edge swipe. Its
//   touches go to the shell through the `NativeGestureSink`, begin to end, and
//   the page never has them.
// - It moves along the edge or back out, lifts, waits too long, or a second
//   finger lands: the page's. The withheld touches go to it as they came,
//   ahead of the touch that decided.
//
// Every finger landing outside the band, and every finger while another is
// down, is the page's at once. One per device; the caller holds the withheld
// touches and dispatches them.
class EVENTS_EXPORT EdgeSwipe {
 public:
  enum class Verdict {
    // Dispatch this touch.
    kDispatch,
    // Withhold this touch until a later verdict.
    kWithhold,
    // Dispatch the withheld touches, then this one.
    kRelease,
    // The shell has this touch: drop it, and any withheld.
    kTaken,
  };

  EdgeSwipe();
  EdgeSwipe(const EdgeSwipe&) = delete;
  EdgeSwipe& operator=(const EdgeSwipe&) = delete;
  ~EdgeSwipe();

  // A touch of `slot` at `location` on `display`, both in the display's
  // pixels, as dispatched.
  Verdict Touch(EventType type,
                int slot,
                const gfx::PointF& location,
                const gfx::RectF& display,
                base::TimeTicks time);

  // When the withheld finger is the page's if nothing decides first, or none
  // while nothing is withheld.
  std::optional<base::TimeTicks> deadline() const { return deadline_; }

  // The withheld finger waited too long: the caller dispatches what it held.
  void Expire();

 private:
  enum class State {
    // No finger down.
    kIdle,
    // One finger at an edge, withheld.
    kDeciding,
    // The withheld finger is an edge swipe, the shell's.
    kSwiping,
    // The fingers down are the page's.
    kPage,
  };

  // The edges whose band a finger at `location` lands in, nearest first: two
  // in a corner, one along a side, none elsewhere.
  static std::vector<NativeGestureEdge> EdgesAt(const gfx::PointF& location,
                                                const gfx::RectF& display);

  // How far `location` has come in from the edge, and along it, as shares of
  // the display.
  gfx::Vector2dF Travel(const gfx::PointF& location) const;

  Verdict Decide(EventType type, const gfx::PointF& location);
  Verdict Swipe(EventType type, const gfx::PointF& location);

  // Hands the sink one phase of the swipe.
  void Tell(NativeGesturePhase phase,
            const gfx::Vector2dF& motion,
            bool canceled);

  State state_ = State::kIdle;
  std::vector<int> down_;
  // The finger at the edge, from landing until it lifts.
  int slot_ = 0;
  NativeGestureEdge edge_ = NativeGestureEdge::kLeft;
  gfx::RectF display_;
  gfx::PointF start_;
  gfx::PointF last_;
  std::optional<base::TimeTicks> deadline_;
};

}  // namespace ui

#endif  // UI_EVENTS_DOMICILE_EDGE_SWIPE_H_
