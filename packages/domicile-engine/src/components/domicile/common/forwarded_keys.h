// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_COMMON_FORWARDED_KEYS_H_
#define COMPONENTS_DOMICILE_COMMON_FORWARDED_KEYS_H_

#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <utility>
#include <vector>

namespace domicile {

// Where each key's release goes: to the window its press was forwarded for,
// or nowhere, when the engine took the press as a chord.
//
// Templated over the window id, so Blink keeps its own string and the tests
// need no Blink.
template <typename App>
class ForwardedKeys {
 public:
  // The press of `keycode` was forwarded for `app`. Ends a taken press whose
  // release was lost -- heard by a guest the chord focused, or by another
  // monitor's page -- or this release is kept from the window, which repeats
  // the key until it is pressed again.
  void Forward(uint32_t keycode, const App& app) {
    taken_.erase(keycode);
    held_[keycode] = app;
  }

  // The press of `keycode` was taken. Not a key already down for a window:
  // a modifier pressed while it is held makes its repeats chords, but its
  // release is still the window's.
  void Take(uint32_t keycode) {
    if (!held_.contains(keycode)) {
      taken_.insert(keycode);
    }
  }

  // `keycode` came up. True, once, if its press was taken.
  bool TakenUp(uint32_t keycode) { return taken_.erase(keycode) > 0; }

  // `keycode` came up. The window its press was forwarded for, once.
  std::optional<App> HeldUp(uint32_t keycode) {
    const auto held = held_.find(keycode);
    if (held == held_.end()) {
      return std::nullopt;
    }
    App app = std::move(held->second);
    held_.erase(held);
    return app;
  }

  // Every key held for a window, by keycode, forgetting them.
  std::vector<std::pair<uint32_t, App>> TakeHeld() {
    std::vector<std::pair<uint32_t, App>> held(held_.begin(), held_.end());
    held_.clear();
    return held;
  }

 private:
  std::map<uint32_t, App> held_;
  std::set<uint32_t> taken_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_COMMON_FORWARDED_KEYS_H_
