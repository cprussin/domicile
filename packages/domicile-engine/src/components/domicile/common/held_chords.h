// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_COMMON_HELD_CHORDS_H_
#define COMPONENTS_DOMICILE_COMMON_HELD_CHORDS_H_

#include <algorithm>
#include <utility>
#include <vector>

namespace domicile {

// The grabbed chords the keyboard holds, so each press is paired with one
// release: its key coming up, or one of its modifiers.
//
// Templated over the press, any `{keycode, alt, ctrl, shift, meta}` with `==`,
// so Blink keeps its own type and the tests need no Blink.
template <typename Chord>
class HeldChords {
 public:
  // `chord` fired. A chord already held is held once.
  void Press(const Chord& chord) {
    if (std::ranges::find(held_, chord) == held_.end()) {
      held_.push_back(chord);
    }
  }

  // A key came up: `up.keycode` is the key and `up`'s modifiers are those
  // still held. Calls `released` with each chord this lets go, in the order
  // they were pressed, after forgetting them all, so `released` may press
  // again.
  template <typename Released>
  void Release(const Chord& up, Released released) {
    std::vector<Chord> kept;
    std::vector<Chord> let_go;
    for (const Chord& chord : held_) {
      (Ends(chord, up) ? let_go : kept).push_back(chord);
    }
    held_ = std::move(kept);
    for (const Chord& chord : let_go) {
      released(chord);
    }
  }

 private:
  static bool Ends(const Chord& chord, const Chord& up) {
    return chord.keycode == up.keycode || (chord.alt && !up.alt) ||
           (chord.ctrl && !up.ctrl) || (chord.shift && !up.shift) ||
           (chord.meta && !up.meta);
  }

  std::vector<Chord> held_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_COMMON_HELD_CHORDS_H_
