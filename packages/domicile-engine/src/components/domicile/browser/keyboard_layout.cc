// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/keyboard_layout.h"

#include <string>
#include <string_view>

#include "base/logging.h"
#include "ui/events/ozone/layout/keyboard_layout_engine_manager.h"

namespace domicile {

bool ApplyKeymap(ui::KeyboardLayoutEngine* engine, std::string_view keymap) {
  // Pass the full length. Unlike WaylandKeyboard::OnKeymap, which strips a
  // trailing NUL, this keymap comes from a JSON string with no NUL.
  const bool applied =
      engine->SetCurrentLayoutFromBuffer(keymap.data(), keymap.size());
  if (!applied) {
    // No fallback: the engine keeps its previous state, which is usually the
    // null state that decodes printable keys to nothing.
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
