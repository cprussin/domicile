// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_DESK_LOCK_H_
#define COMPONENTS_DOMICILE_BROWSER_DESK_LOCK_H_

namespace domicile {

// Whether the desk is locked, as last reported by the compositor.
//
// The compositor blocks its own home reads while locked (see
// `crate::lock::refused`), but `domicile://home/` is served from the browser
// process. The control channel records the `locked` message here so that
// loader can check it.
//
// Process-wide and atomic because the loader reads it from a different thread
// than the channel writes it. Starts unlocked, since a desk with no lock
// configured never sends the message.
class DeskLock {
 public:
  static bool IsLocked();
  static void Set(bool locked);
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DESK_LOCK_H_
