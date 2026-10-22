// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DESK_POINTER_H_
#define COMPONENTS_DOMICILE_BROWSER_DESK_POINTER_H_

#include <stdint.h>

#include <optional>
#include <utility>
#include <vector>

#include "base/functional/callback.h"
#include "base/synchronization/lock.h"
#include "base/thread_annotations.h"
#include "ui/gfx/geometry/point_f.h"

namespace domicile {

// Where the pointer is on the desk, for the compositor's screen casts.
//
// The compositor hears the pointer only over a window, from the shell. Over
// the shell's page or a browser window it would not know where to draw the
// pointer into a cast. The browser reports each move here
// (`StartDeskPointer` in //chrome/browser/domicile), in the shell page's CSS
// pixels, and this tells every control channel.
//
// Moved on the UI thread and listened for from the IO thread, hence the lock.
// Callers must wrap callbacks with `base::BindPostTask`: they run on the
// thread that heard the move, and never under the lock.
class DeskPointer {
 public:
  // Handle for removing a listener. Never zero.
  using ListenerId = uint64_t;
  // Where the pointer is, or `std::nullopt` off the desk.
  using Moved = base::RepeatingCallback<void(std::optional<gfx::PointF>)>;

  // The process-wide one. Tests build their own instead.
  static DeskPointer& Get();

  DeskPointer();
  DeskPointer(const DeskPointer&) = delete;
  DeskPointer& operator=(const DeskPointer&) = delete;
  ~DeskPointer();

  // Calls `moved` on each later move.
  ListenerId AddListener(Moved moved);
  void RemoveListener(ListenerId listener);

  // The pointer is at `at`, or left the desk. A place it is already at tells
  // nobody: aura restates a still pointer after a window changes.
  void MovedTo(std::optional<gfx::PointF> at);

 private:
  base::Lock lock_;
  ListenerId next_id_ GUARDED_BY(lock_) = 1;
  std::vector<std::pair<ListenerId, Moved>> listeners_ GUARDED_BY(lock_);
  std::optional<gfx::PointF> at_ GUARDED_BY(lock_);
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DESK_POINTER_H_
