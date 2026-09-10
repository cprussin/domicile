// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_BROWSER_SHORTCUT_REGISTRY_H_
#define COMPONENTS_DOMICILE_BROWSER_SHORTCUT_REGISTRY_H_

#include <stdint.h>

#include <optional>
#include <vector>

#include "base/functional/callback.h"
#include "base/synchronization/lock.h"
#include "base/thread_annotations.h"

namespace domicile {

// A key combination the desktop has claimed for itself.
//
// `keycode` is a Linux evdev code -- the numbering the control protocol speaks
// everywhere, not the XKB keycode a Wayland keymap uses, which is this plus 8.
struct Chord {
  uint32_t keycode = 0;
  bool alt = false;
  bool ctrl = false;
  bool shift = false;
  bool meta = false;

  friend bool operator==(const Chord&, const Chord&) = default;
};

// Which modifiers the keyboard holds.
//
// Which ones are down, not xkb's four masks: a page asking "is Alt held" cannot
// answer that from a mask without the keymap as well, and this side has already
// resolved it.
struct Modifiers {
  bool alt = false;
  bool ctrl = false;
  bool shift = false;
  bool meta = false;

  friend bool operator==(const Modifiers&, const Modifiers&) = default;
};

// The chords the shell claimed for the desktop, and who to tell when one fires.
//
// WHY THE BROWSER PROCESS HOLDS THESE. The compositor used to, and it is the
// layer that should: it sees a key before the client it belongs to does. It
// cannot any more. A browser window is a `<webview>`, the page inside it is a
// guest, and DOM focus moves into it -- so its keys never reach the shell's
// document and are never forwarded to the compositor either. The browser
// process is the only layer above a focused guest, which makes it the only one
// that can take a chord out of the stream.
// WebViewGuest::PreHandleKeyboardEvent is where a key meets these.
//
// TWO SEQUENCES, WHICH IS WHY THERE IS A LOCK. A claim arrives on a
// `ControlChannel`, which lives on the IO thread because it talks to a unix
// socket; a keystroke arrives in `WebViewGuest::PreHandleKeyboardEvent`, which
// is content calling on the UI thread. Neither can be moved to the other's
// sequence without moving the thing it exists to talk to. A channel's callbacks
// are therefore expected to be `base::BindPostTask`-wrapped by whoever
// registers them -- this invokes them on the sequence a press arrived on, and
// never holds the lock while it does.
//
// THE CLAIMS ARE THE PROCESS'S, not a document's, and that is the shape rather
// than an oversight: a `ControlChannel` is bound without a frame, so there is
// nothing here to key them on. One shell per browser is the arrangement
// Domicile ships; a second shell in the same process would hear the first
// one's chords.
class ShortcutRegistry {
 public:
  using ShortcutCallback = base::RepeatingCallback<void(Chord)>;
  using ModifiersCallback = base::RepeatingCallback<void(Modifiers)>;

  // A registration's handle, for giving it back. Never zero.
  using ChannelId = uint64_t;

  // The process's registry: the one a ControlChannel claims into and a guest
  // matches against. Tests build their own on the stack instead.
  static ShortcutRegistry& Get();

  ShortcutRegistry();

  ShortcutRegistry(const ShortcutRegistry&) = delete;
  ShortcutRegistry& operator=(const ShortcutRegistry&) = delete;

  ~ShortcutRegistry();

  // Start delivering to a page. Both callbacks may be run on any sequence, so
  // both are expected to be posted back to the caller's own.
  ChannelId AddChannel(ShortcutCallback on_shortcut,
                       ModifiersCallback on_modifiers);

  // Stop. `channel` is the id AddChannel returned; the claims it made stay,
  // because a page that reloads is the same desktop claiming the same keys and
  // a gap between the two is a chord that reaches the focused window instead.
  void RemoveChannel(ChannelId channel);

  // Claim `chord` for the desktop. Claiming one twice is not an error -- it is
  // one claim, which is what the shell's own effect relies on when it re-runs.
  void Grab(const Chord& chord);

  // A key went down. Tells every channel when `chord` is one of the claims, and
  // answers whether it was -- the caller swallows the key exactly when this is
  // true, so that a window never sees a key the desktop took.
  bool Press(const Chord& chord);

  // The modifiers held now. Delivered only when they differ from the last set
  // delivered, including the first time: a shell assumes nothing is held until
  // it is told, and a keystroke typed with Alt down would otherwise report the
  // same set once per key.
  void SetModifiers(const Modifiers& modifiers);

 private:
  // Whether `chord` is one of the claims. `base::Contains` is what this would
  // have been; `base/containers/contains.h` is gone from the tree at our pin,
  // and `std::ranges::find` is what the tree reaches for in its place.
  bool IsGrabbed(const Chord& chord) const EXCLUSIVE_LOCKS_REQUIRED(lock_);

  struct Channel {
    ChannelId id;
    ShortcutCallback on_shortcut;
    ModifiersCallback on_modifiers;
  };

  base::Lock lock_;
  std::vector<Chord> grabbed_ GUARDED_BY(lock_);
  std::vector<Channel> channels_ GUARDED_BY(lock_);
  std::optional<Modifiers> reported_ GUARDED_BY(lock_);
  ChannelId next_id_ GUARDED_BY(lock_) = 1;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_SHORTCUT_REGISTRY_H_
