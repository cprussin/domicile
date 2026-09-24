// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_files_event.h"

#include <utility>

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_files_event_init.h"

namespace blink {

// static
DomicileFilesEvent* DomicileFilesEvent::Create(
    const AtomicString& type,
    const DomicileFilesEventInit* initializer) {
  return MakeGarbageCollected<DomicileFilesEvent>(type, initializer);
}

DomicileFilesEvent::DomicileFilesEvent(
    const AtomicString& type,
    const DomicileFilesEventInit* initializer)
    : Event(type, initializer),
      files_(MakeGarbageCollected<FrozenArray<IDLString>>(
          initializer->files())),
      arrival_(initializer->arrival()) {}

DomicileFilesEvent::DomicileFilesEvent(const AtomicString& type,
                                       Vector<String> files,
                                       DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      files_(MakeGarbageCollected<FrozenArray<IDLString>>(std::move(files))),
      arrival_(arrival) {}

DomicileFilesEvent::~DomicileFilesEvent() = default;

const AtomicString& DomicileFilesEvent::InterfaceName() const {
  return event_interface_names::kDomicileFilesEvent;
}

void DomicileFilesEvent::Trace(Visitor* visitor) const {
  visitor->Trace(files_);
  Event::Trace(visitor);
}

}  // namespace blink
