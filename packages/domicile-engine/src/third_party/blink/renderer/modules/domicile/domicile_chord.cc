// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_chord.h"

#include "third_party/blink/renderer/platform/wtf/text/ascii_ctype.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"

namespace blink {

namespace {

// The modifier `part` names, as a member of `chord`, or nullptr.
bool* Modifier(DomicileWrittenChord& chord, const String& part) {
  const String name = part.ToAsciiLower();
  if (name == "alt" || name == "mod1") {
    return &chord.alt;
  }
  if (name == "control" || name == "ctrl") {
    return &chord.ctrl;
  }
  if (name == "shift") {
    return &chord.shift;
  }
  if (name == "meta" || name == "logo" || name == "mod4" || name == "super") {
    return &chord.meta;
  }
  return nullptr;
}

}  // namespace

std::optional<DomicileWrittenChord> ParseDomicileChord(const String& written,
                                                       String* error) {
  const String quoted = "\"" + written + "\"";
  for (wtf_size_t at = 0; at < written.length(); ++at) {
    if (IsAsciiSpace(written[at])) {
      *error = "chord " + quoted +
               " has whitespace in it; write it as `Meta+Shift+a`";
      return std::nullopt;
    }
  }
  const Vector<String> parts = written.Split('+');
  DomicileWrittenChord chord;
  chord.keysym = parts.back();
  if (chord.keysym.empty() || Modifier(chord, chord.keysym)) {
    *error = "chord " + quoted + " names no key; its last part is the keysym";
    return std::nullopt;
  }
  for (wtf_size_t at = 0; at + 1 < parts.size(); ++at) {
    bool* held = Modifier(chord, parts[at]);
    if (!held) {
      *error = "chord " + quoted + ": \"" + parts[at] + "\" is not a modifier";
      return std::nullopt;
    }
    if (*held) {
      *error = "chord " + quoted + " holds \"" + parts[at] +
               "\" twice, under one spelling or two";
      return std::nullopt;
    }
    *held = true;
  }
  return chord;
}

std::optional<DomicilePress> ResolveDomicileChord(
    const DomicileWrittenChord& chord,
    const HashMap<String, uint32_t>& keys) {
  const auto key = keys.find(chord.keysym);
  if (key == keys.end()) {
    return std::nullopt;
  }
  return DomicilePress{key->value, chord.alt, chord.ctrl, chord.shift,
                       chord.meta};
}

}  // namespace blink
