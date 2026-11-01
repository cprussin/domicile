// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_clipboard_entry.h"

namespace blink {

DomicileClipboardEntry::DomicileClipboardEntry(uint32_t id,
                                               bool image,
                                               const String& preview,
                                               const String& thumbnail)
    : id_(id), image_(image), preview_(preview), thumbnail_(thumbnail) {}

DomicileClipboardEntry::~DomicileClipboardEntry() = default;

void DomicileClipboardEntry::Trace(Visitor* visitor) const {
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
