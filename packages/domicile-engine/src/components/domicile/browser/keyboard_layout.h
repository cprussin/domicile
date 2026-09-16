// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_BROWSER_KEYBOARD_LAYOUT_H_
#define COMPONENTS_DOMICILE_BROWSER_KEYBOARD_LAYOUT_H_

#include <string>
#include <string_view>

#include "ui/events/ozone/layout/keyboard_layout_engine.h"

namespace domicile {

// Give a keyboard layout engine the keymap the compositor compiled.
//
// THIS IS THE ONLY THING ON THIS PLATFORM THAT EVER DOES. A browser decodes a
// key press through KeyboardLayoutEngineManager's engine, which on Linux is an
// XkbKeyboardLayoutEngine, and that engine has no keymap in it until somebody
// hands it one. The two members that would are
// XkbKeyboardLayoutEngine::SetCurrentLayoutByName -- `#if
// BUILDFLAG(IS_CHROMEOS)` around a NOTIMPLEMENTED(), with
// CanSetCurrentLayout() answering false to match -- and
// SetCurrentLayoutFromBuffer, which is not gated and whose one caller in the
// tree is WaylandKeyboard::OnKeymap, handling `wl_keyboard.keymap` for the
// *Wayland* ozone platform. Domicile is a non-ChromeOS DRM/Ozone build running
// neither, so without this `xkb_state_` is null for the life of the process.
//
// What that looks like is worth knowing, because it is not a crash and it is
// not silence either: XkbLookup logs `No current XKB state` and returns false,
// Lookup falls back to DomCodeToNonPrintableDomKey -- a static table -- and
// still returns true. Escape, the function keys and every chord built out of
// them go on working, which is why this survived a tty run. A printable key is
// not in that table: it comes out as DomKey::UNIDENTIFIED with the US-QWERTY
// KeyboardCode for wherever the key physically sits, so a page is handed a
// keystroke with no `key` and no text in it. A shell nobody can type into.
//
// `engine` rather than the manager's, so this can be asserted against a real
// XkbKeyboardLayoutEngine without a browser -- see
// keyboard_layout_unittest.cc, which is where the paragraph above is written
// as a test. SetProcessKeymap below is the one-line caller that reads the
// manager.
//
// Returns whether xkb accepted the keymap. A refusal is logged here; nothing
// falls back, because the only thing to fall back to is the null state this
// exists to replace.
bool ApplyKeymap(ui::KeyboardLayoutEngine* engine, std::string_view keymap);

// The same, against the engine this process decodes its keys with.
//
// Must run on the UI thread: the engine belongs to it, and so does every
// evdev key dispatched through it. The compositor's socket is read on the IO
// thread, so the control channel is handed this already bound to a UI task
// runner rather than reaching for one -- see ControlChannel's constructor.
void SetProcessKeymap(const std::string& keymap);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_KEYBOARD_LAYOUT_H_
