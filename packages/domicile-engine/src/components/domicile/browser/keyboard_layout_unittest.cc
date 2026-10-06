// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

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

// A minimal keymap that maps the QWERTY `s` key to `o`, as programmer Dvorak
// does.
//
// `39` is the X keycode for KEY_S: evdev's 31 plus X's offset of 8.
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

// The layout engine's result for one key press.
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

// Without a keymap, Lookup falls back to a table of non-printable keys. It
// still succeeds, but a letter decodes to DomKey::UNIDENTIFIED with the
// US-QWERTY code for its position.
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

// A keymap xkb cannot compile is reported as a failure.
TEST(DomicileKeyboardLayoutTest, AKeymapXkbRefusesIsRefusedHere) {
  ui::XkbEvdevCodes evdev_codes;
  ui::XkbKeyboardLayoutEngine engine(evdev_codes);

  EXPECT_FALSE(ApplyKeymap(&engine, "xkb_keymap { this is not one };"));
}

}  // namespace
}  // namespace domicile
