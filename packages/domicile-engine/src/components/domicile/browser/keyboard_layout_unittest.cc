// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/keyboard_layout.h"


#include "testing/gtest/include/gtest/gtest.h"
#include "ui/events/event_constants.h"
#include "ui/events/keycodes/dom/dom_code.h"
#include "ui/events/keycodes/dom/dom_key.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/events/ozone/layout/xkb/xkb_evdev_codes.h"
#include "ui/events/ozone/layout/xkb/xkb_keyboard_layout_engine.h"

namespace domicile {
namespace {

// A keymap saying one thing, and that thing is not QWERTY: the key a US
// keyboard prints `s` on carries an `o`, which is where programmer Dvorak --
// the layout this engine's user configured -- puts it.
//
// Hand-written and tiny rather than the 40 kilobytes xkb writes for a real
// layout, because what is under test is the seam and not xkbcommon: the one
// assertion a full keymap would add is that xkb can compile its own output.
// `39` is the X keycode for KEY_S, which is evdev's 31 plus the 8 every X
// keycode carries -- the same arithmetic XkbEvdevCodes does to reach it from
// DomCode::US_S.
constexpr char kOnWhereQwertyHasS[] = R"(xkb_keymap {
  xkb_keycodes "domicile" {
    minimum = 8;
    maximum = 255;
    <AC02> = 39;
  };
  xkb_types "domicile" {
    virtual_modifiers NumLock;
    type "ONE_LEVEL" {
      modifiers = none;
      level_name[Level1] = "Any";
    };
  };
  xkb_compatibility "domicile" { };
  xkb_symbols "domicile" {
    key <AC02> { type = "ONE_LEVEL", [ o ] };
  };
};
)";

// What a key press asks the layout engine, and what came back.
struct Decoded {
  bool answered;
  ui::DomKey key;
  ui::KeyboardCode code;
};

Decoded Press(const ui::KeyboardLayoutEngine& engine, ui::DomCode code) {
  Decoded decoded = {false, ui::DomKey::NONE, ui::VKEY_UNKNOWN};
  decoded.answered =
      engine.Lookup(code, ui::EF_NONE, &decoded.key, &decoded.code);
  return decoded;
}

// THE BUG, WRITTEN DOWN. Off ChromeOS nothing sets this engine a keymap:
// SetCurrentLayoutByName is #if BUILDFLAG(IS_CHROMEOS) around a
// NOTIMPLEMENTED(), and SetCurrentLayoutFromBuffer -- which is not gated --
// has exactly one caller in the tree, WaylandKeyboard::OnKeymap. A DRM/Ozone
// browser runs neither, so `xkb_state_` is null for the life of the process
// and XkbLookup bails with `No current XKB state` at every press.
//
// What that costs is only visible on a PRINTABLE key. Lookup still returns
// true -- it falls back to DomCodeToNonPrintableDomKey, a static table -- so
// Escape and the function keys carry on working and the desktop looks fine.
// A letter falls off the end of that table into DomKey::UNIDENTIFIED and the
// US-QWERTY code for wherever the key physically is, which is a shell that
// types nothing whatever layout its user configured.
TEST(DomicileKeyboardLayoutTest, WithNoKeymapAPrintableKeyDecodesToNothing) {
  ui::XkbEvdevCodes evdev_codes;
  ui::XkbKeyboardLayoutEngine engine(evdev_codes);

  const Decoded pressed = Press(engine, ui::DomCode::US_S);

  EXPECT_TRUE(pressed.answered) << "it answers, which is why this looked fine";
  EXPECT_EQ(ui::DomKey::UNIDENTIFIED, pressed.key);
  EXPECT_EQ(ui::VKEY_S, pressed.code) << "the position, not the layout";
}

TEST(DomicileKeyboardLayoutTest, TheCompositorsKeymapIsWhatAKeyDecodesAs) {
  ui::XkbEvdevCodes evdev_codes;
  ui::XkbKeyboardLayoutEngine engine(evdev_codes);

  ASSERT_TRUE(ApplyKeymap(&engine, kOnWhereQwertyHasS));

  const Decoded pressed = Press(engine, ui::DomCode::US_S);

  ASSERT_TRUE(pressed.answered);
  EXPECT_EQ(ui::DomKey::FromCharacter('o'), pressed.key)
      << "the character the user's layout puts there";
  EXPECT_EQ(ui::VKEY_O, pressed.code)
      << "and the keycode a shortcut is matched on with it";
}

// A keymap xkb will not compile is reported rather than absorbed. The caller
// is a socket the compositor writes, and a browser that kept its old layout --
// which is no layout at all -- while saying nothing is the silence this whole
// change exists to end.
TEST(DomicileKeyboardLayoutTest, AKeymapXkbRefusesIsRefusedHere) {
  ui::XkbEvdevCodes evdev_codes;
  ui::XkbKeyboardLayoutEngine engine(evdev_codes);

  EXPECT_FALSE(ApplyKeymap(&engine, "xkb_keymap { this is not one };"));
}

}  // namespace
}  // namespace domicile
