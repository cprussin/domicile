// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_desktop_entry.h"

#include <utility>

namespace blink {

DomicileDesktopEntry::DomicileDesktopEntry(const String& id,
                                           const String& name,
                                           const String& comment,
                                           Vector<String> command,
                                           const String& icon)
    : id_(id),
      name_(name),
      comment_(comment),
      command_(MakeGarbageCollected<FrozenArray<IDLString>>(
          std::move(command))),
      icon_(icon) {}

DomicileDesktopEntry::~DomicileDesktopEntry() = default;

void DomicileDesktopEntry::Trace(Visitor* visitor) const {
  visitor->Trace(command_);
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
