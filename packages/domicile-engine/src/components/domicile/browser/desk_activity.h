// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DESK_ACTIVITY_H_
#define COMPONENTS_DOMICILE_BROWSER_DESK_ACTIVITY_H_

#include <stdint.h>

#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/functional/callback.h"
#include "base/synchronization/lock.h"
#include "base/thread_annotations.h"

namespace domicile {

// Somebody using the desk, for the compositor's idle clock.
//
// The compositor hears only the input the shell forwards to its windows. A key
// typed into a browser window, or into the shell's own page, reaches neither,
// so without this the desk locks under somebody typing. Every input event the
// browser process dispatches is reported here (`StartDeskActivity` in
// //chrome/browser/domicile), and this tells every control channel.
//
// Heard on the UI thread and listened for from the IO thread, hence the lock.
// Callers must wrap callbacks with `base::BindPostTask`: they run on the
// thread that heard the input, and never under the lock.
class DeskActivity {
 public:
  // Handle for removing a listener. Never zero.
  using ListenerId = uint64_t;

  // The process-wide one. Tests build their own instead.
  static DeskActivity& Get();

  DeskActivity();
  DeskActivity(const DeskActivity&) = delete;
  DeskActivity& operator=(const DeskActivity&) = delete;
  ~DeskActivity();

  // Hears what the input was, as `DescribeInput` names it.
  using Listener = base::RepeatingCallback<void(const std::string& input)>;

  // Calls `heard` on each later `Heard`.
  ListenerId AddListener(Listener heard);
  void RemoveListener(ListenerId listener);

  // Somebody used the keyboard, the pointer or a touchpad. `input` names
  // what, for the compositor's log.
  void Heard(const std::string& input);

 private:
  base::Lock lock_;
  ListenerId next_id_ GUARDED_BY(lock_) = 1;
  std::vector<std::pair<ListenerId, Listener>> listeners_ GUARDED_BY(lock_);
};

// Names an input event for the compositor's log: the event's own name, and
// the device it came from when the device is known, e.g. "MousePressed from
// Logitech USB Receiver". A device that keeps the desk awake by itself is
// found by its name.
std::string DescribeInput(std::string_view event, std::string_view device);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DESK_ACTIVITY_H_
