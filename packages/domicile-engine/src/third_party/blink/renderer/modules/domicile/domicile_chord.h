// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CHORD_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CHORD_H_

#include <cstdint>
#include <optional>

#include "third_party/blink/renderer/platform/wtf/hash_map.h"
#include "third_party/blink/renderer/platform/wtf/text/string_hash.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// A chord as a shell writes it -- `Meta+Shift+l`, sway's grammar -- split into
// the keysym it ends in and the modifiers it holds. Which key the keysym is on
// is the keyboard's, so this is only the half that needs no keyboard.
struct DomicileWrittenChord {
  String keysym;
  bool alt = false;
  bool ctrl = false;
  bool shift = false;
  bool meta = false;
};

// A chord as a press arrives: the evdev key and the modifiers held.
struct DomicilePress {
  uint32_t keycode = 0;
  bool alt = false;
  bool ctrl = false;
  bool shift = false;
  bool meta = false;

  bool operator==(const DomicilePress&) const = default;
};

// `written` split, or nullopt with `error` saying what is wrong with it: no
// whitespace, the last part a keysym, every other part a modifier
// (`Alt`/`Mod1`, `Control`/`Ctrl`, `Shift`, `Meta`/`Logo`/`Mod4`/`Super`, in
// any case), none held twice. The same grammar `@domicile-desktop/sdk`'s
// `own-keybindings` reads.
std::optional<DomicileWrittenChord> ParseDomicileChord(const String& written,
                                                       String* error);

// The press `chord` arrives as on a keyboard whose keysyms are on `keys`, or
// nullopt for a keysym the keyboard cannot type.
std::optional<DomicilePress> ResolveDomicileChord(
    const DomicileWrittenChord& chord,
    const HashMap<String, uint32_t>& keys);

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CHORD_H_
