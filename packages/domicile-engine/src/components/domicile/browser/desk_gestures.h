// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DESK_GESTURES_H_
#define COMPONENTS_DOMICILE_BROWSER_DESK_GESTURES_H_

#include <stdint.h>

#include <optional>
#include <vector>

#include "base/functional/callback.h"
#include "base/synchronization/lock.h"
#include "base/thread_annotations.h"
#include "ui/events/domicile/native_gesture_sink.h"
#include "ui/events/types/native_gesture.h"

namespace domicile {

// A gesture the shell binds: its kind and finger count, or any count for
// `fingers` 0. An edge swipe's grab names its edge, or none for any.
struct GestureGrab {
  ui::NativeGestureKind kind = ui::NativeGestureKind::kSwipe;
  uint32_t fingers = 0;
  std::optional<ui::NativeGestureEdge> edge;

  friend bool operator==(const GestureGrab&, const GestureGrab&) = default;
};

// The touchpad gestures the shell grabbed, and who to tell when one happens.
//
// The platform recognizes gestures in the browser process -- libinput on a
// tty, the host's `zwp_pointer_gestures_v1` nested -- and asks this, as the
// installed `ui::NativeGestureSink`, whether the shell takes each one at its
// begin. A gesture the shell takes goes, every phase, to the one channel that
// took its begin: each page grabs the same gestures, and telling every page
// would run a binding once per monitor.
//
// Grabs arrive on a `ControlChannel` on the IO thread and gestures on the
// platform's input thread, hence the lock. Callers wrap callbacks with
// `base::BindPostTask`: they run on the thread a gesture arrives on, and never
// under the lock.
class DeskGestures : public ui::NativeGestureSink {
 public:
  using Performed = base::RepeatingCallback<void(const ui::NativeGesture&)>;

  // Handle for removing a channel. Never zero.
  using ChannelId = uint64_t;

  // The process-wide one, installed as the platform's gesture sink. Tests
  // build their own instead.
  static DeskGestures& Get();

  DeskGestures();
  DeskGestures(const DeskGestures&) = delete;
  DeskGestures& operator=(const DeskGestures&) = delete;
  ~DeskGestures() override;

  // A page that can grab gestures, told each phase of one it took.
  ChannelId AddChannel(Performed performed);

  // Drops `channel` and its grabs. A gesture it took ends unheard.
  void RemoveChannel(ChannelId channel);

  // `channel` takes `grab`. A second grab of it changes nothing: the page
  // counts its own grabs, as it does chords.
  void Grab(ChannelId channel, GestureGrab grab);

  // `channel` gives `grab` back.
  void Ungrab(ChannelId channel, GestureGrab grab);

  // ui::NativeGestureSink:
  bool Takes(const ui::NativeGesture& begin) override;
  void Take(const ui::NativeGesture& gesture) override;

 private:
  struct Channel {
    ChannelId id = 0;
    Performed performed;
    std::vector<GestureGrab> grabs;
  };

  // The first channel grabbing the gesture `begin` begins.
  const Channel* Grabbing(const ui::NativeGesture& begin) const
      EXCLUSIVE_LOCKS_REQUIRED(lock_);

  base::Lock lock_;
  ChannelId next_id_ GUARDED_BY(lock_) = 1;
  std::vector<Channel> channels_ GUARDED_BY(lock_);
  // The channel that took the gesture in progress.
  std::optional<ChannelId> owner_ GUARDED_BY(lock_);
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DESK_GESTURES_H_
