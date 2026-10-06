// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_KEYBOARD_LAYOUT_H_
#define COMPONENTS_DOMICILE_BROWSER_KEYBOARD_LAYOUT_H_

#include <string>
#include <string_view>

#include "ui/events/ozone/layout/keyboard_layout_engine.h"

namespace domicile {

// Loads the compositor's compiled keymap into a keyboard layout engine.
//
// Nothing else sets a keymap on a non-ChromeOS DRM/Ozone build:
// SetCurrentLayoutByName is ChromeOS-only, and SetCurrentLayoutFromBuffer is
// only called by the Wayland ozone platform. Without a keymap, printable keys
// decode to DomKey::UNIDENTIFIED, while Escape and function keys still work.
//
// Takes `engine` so tests can use a real XkbKeyboardLayoutEngine. Returns
// whether xkb accepted the keymap, and logs a refusal.
bool ApplyKeymap(ui::KeyboardLayoutEngine* engine, std::string_view keymap);

// Applies `keymap` to this process's keyboard layout engine.
//
// Must run on the UI thread, which owns the engine. ControlChannel's
// constructor receives this bound to a UI task runner.
void SetProcessKeymap(const std::string& keymap);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_KEYBOARD_LAYOUT_H_
