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

// Applies `keymap` to DeskKeyboardLayout and this process's keyboard layout
// engine.
//
// Must run on the UI thread, which owns the engines. ControlChannel's
// constructor receives this bound to a UI task runner.
void SetProcessKeymap(const std::string& keymap);

// The compositor's keymap alone: what a key the compositor names by evdev
// code, such as an agent seat's, types. Not the process's engine, which on the
// Wayland platform holds the host seat's keymap, and is replaced with each
// keymap the host sends (wtype's, a virtual keyboard's, a layout switch).
ui::KeyboardLayoutEngine& DeskKeyboardLayout();

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_KEYBOARD_LAYOUT_H_
