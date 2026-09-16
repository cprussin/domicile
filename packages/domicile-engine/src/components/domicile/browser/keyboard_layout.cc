// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/keyboard_layout.h"

#include <string>
#include <string_view>

#include "base/logging.h"
#include "ui/events/ozone/layout/keyboard_layout_engine_manager.h"

namespace domicile {

bool ApplyKeymap(ui::KeyboardLayoutEngine* engine, std::string_view keymap) {
  // THE WHOLE STRING, which is where this caller differs from the Wayland one.
  // There the keymap arrives as a file the client mapped and the size counts a
  // trailing NUL, so WaylandKeyboard::OnKeymap strnlen()s it back off before
  // handing it over. Here it arrives as a JSON string with no NUL in it, and
  // xkb_keymap_new_from_buffer takes the length it is given -- so the length is
  // the string's own.
  const bool applied =
      engine->SetCurrentLayoutFromBuffer(keymap.data(), keymap.size());
  if (!applied) {
    // Said, and nothing put in its place. What the engine keeps is whatever it
    // had, which on this platform is the null xkb state that answers every
    // printable key with nothing -- and a browser quietly going on with that
    // is the failure this message exists to end rather than one to absorb.
    LOG(ERROR) << "domicile: xkb refused the keymap the compositor sent ("
               << keymap.size()
               << " bytes). Keys will not carry the layout that was "
                  "configured; printable ones will not carry anything.";
  }
  return applied;
}

void SetProcessKeymap(const std::string& keymap) {
  ApplyKeymap(ui::KeyboardLayoutEngineManager::GetKeyboardLayoutEngine(),
              keymap);
}

}  // namespace domicile
