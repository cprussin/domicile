// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/domicile_clipboard_entry.h"

namespace blink {

DomicileClipboardEntry::DomicileClipboardEntry(uint32_t id,
                                               const String& preview)
    : id_(id), preview_(preview) {}

DomicileClipboardEntry::~DomicileClipboardEntry() = default;

void DomicileClipboardEntry::Trace(Visitor* visitor) const {
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
