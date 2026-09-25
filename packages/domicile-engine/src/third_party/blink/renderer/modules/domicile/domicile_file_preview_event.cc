// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_file_preview_event.h"

#include <utility>

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_file_preview_event_init.h"

namespace blink {

// static
DomicileFilePreviewEvent* DomicileFilePreviewEvent::Create(
    const AtomicString& type,
    const DomicileFilePreviewEventInit* initializer) {
  return MakeGarbageCollected<DomicileFilePreviewEvent>(type, initializer);
}

DomicileFilePreviewEvent::DomicileFilePreviewEvent(
    const AtomicString& type,
    const DomicileFilePreviewEventInit* initializer)
    : Event(type, initializer),
      path_(initializer->path()),
      kind_(initializer->kind()),
      text_(initializer->text()),
      entries_(MakeGarbageCollected<FrozenArray<IDLString>>(
          initializer->entries())),
      arrival_(initializer->arrival()) {}

DomicileFilePreviewEvent::DomicileFilePreviewEvent(const AtomicString& type,
                                                   String path,
                                                   String kind,
                                                   String text,
                                                   Vector<String> entries,
                                                   DOMHighResTimeStamp arrival)
    : Event(type, Bubbles::kNo, Cancelable::kNo),
      path_(std::move(path)),
      kind_(std::move(kind)),
      text_(std::move(text)),
      entries_(
          MakeGarbageCollected<FrozenArray<IDLString>>(std::move(entries))),
      arrival_(arrival) {}

DomicileFilePreviewEvent::~DomicileFilePreviewEvent() = default;

const AtomicString& DomicileFilePreviewEvent::InterfaceName() const {
  return event_interface_names::kDomicileFilePreviewEvent;
}

void DomicileFilePreviewEvent::Trace(Visitor* visitor) const {
  visitor->Trace(entries_);
  Event::Trace(visitor);
}

}  // namespace blink
