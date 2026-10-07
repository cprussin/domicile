// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_tray_item.h"

namespace blink {

DomicileTrayItem::DomicileTrayItem(const String& id,
                                   const String& title,
                                   const String& icon,
                                   const String& bus,
                                   const String& menu)
    : id_(id), title_(title), icon_(icon), bus_(bus), menu_(menu) {}

DomicileTrayItem::~DomicileTrayItem() = default;

void DomicileTrayItem::Trace(Visitor* visitor) const {
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
