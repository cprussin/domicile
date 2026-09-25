// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DESK_LOCK_H_
#define COMPONENTS_DOMICILE_BROWSER_DESK_LOCK_H_

namespace domicile {

// Whether the desk is locked, as the compositor last said.
//
// The compositor refuses its own reads of the home while the desk is locked --
// see `crate::lock::refused` -- but `domicile://home/` is read here, in the
// browser process, and the compositor never sees it. So the `locked` message
// every chrome is told is also written down here, where the loader that serves
// the home can ask it.
//
// Process-wide and atomic: every control channel hears the same broadcast, and
// the loader asks from another thread than the one the channel reads on.
// Unlocked until told otherwise, because a desk with no lock configured never
// says anything at all.
class DeskLock {
 public:
  static bool IsLocked();
  static void Set(bool locked);
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DESK_LOCK_H_
