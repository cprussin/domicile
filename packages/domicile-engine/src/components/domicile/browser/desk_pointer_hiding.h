// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DESK_POINTER_HIDING_H_
#define COMPONENTS_DOMICILE_BROWSER_DESK_POINTER_HIDING_H_

#include <stdint.h>

#include <optional>
#include <utility>
#include <vector>

#include "base/functional/callback.h"
#include "base/synchronization/lock.h"
#include "base/thread_annotations.h"
#include "base/time/time.h"

namespace domicile {

// When the browser hides the pointer: after `after` without pointer input,
// and on a typing key press if `when_typing`. The default never hides it.
struct PointerHidingSettings {
  std::optional<base::TimeDelta> after;
  bool when_typing = false;

  bool operator==(const PointerHidingSettings&) const = default;
};

// The desk's pointer hiding settings, from the compositor's `appearance` to
// the browser's pointer (`StartPointerHiding` in //chrome/browser/domicile).
//
// Set on the IO thread and listened for on the UI thread, hence the lock.
// Callers must wrap callbacks with `base::BindPostTask`: they run on the
// thread that set the settings, and never under the lock.
class DeskPointerHiding {
 public:
  // Handle for removing a listener. Never zero.
  using ListenerId = uint64_t;
  using Changed = base::RepeatingCallback<void(const PointerHidingSettings&)>;

  // The process-wide one. Tests build their own instead.
  static DeskPointerHiding& Get();

  DeskPointerHiding();
  DeskPointerHiding(const DeskPointerHiding&) = delete;
  DeskPointerHiding& operator=(const DeskPointerHiding&) = delete;
  ~DeskPointerHiding();

  // Calls `changed` on each later change.
  ListenerId AddListener(Changed changed);
  void RemoveListener(ListenerId listener);

  // The settings now, for a listener added after they were set.
  PointerHidingSettings Now();

  // The desk's settings are `settings`. The settings already in place tell
  // nobody: every shell page's channel hears the same `appearance`.
  void Set(const PointerHidingSettings& settings);

 private:
  base::Lock lock_;
  ListenerId next_id_ GUARDED_BY(lock_) = 1;
  std::vector<std::pair<ListenerId, Changed>> listeners_ GUARDED_BY(lock_);
  PointerHidingSettings settings_ GUARDED_BY(lock_);
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DESK_POINTER_HIDING_H_
