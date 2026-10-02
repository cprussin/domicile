// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/html/domicile/domicile_popup_window_event.h"

#include "third_party/blink/renderer/core/event_interface_names.h"

namespace blink {

// BUBBLES, so a chrome hears it on the window it drew, as it hears
// `domicile-new-window`.
//
// NOT CANCELABLE: the window exists whatever a handler does, and a shell that
// does not want it does not open its <webview>.
DomicilePopupWindowEvent::DomicilePopupWindowEvent(const AtomicString& type,
                                                   int32_t window_id,
                                                   const String& url,
                                                   int32_t width,
                                                   int32_t height)
    : Event(type, Bubbles::kYes, Cancelable::kNo),
      window_id_(window_id),
      url_(url),
      width_(width),
      height_(height) {}

DomicilePopupWindowEvent::~DomicilePopupWindowEvent() = default;

const AtomicString& DomicilePopupWindowEvent::InterfaceName() const {
  return event_interface_names::kDomicilePopupWindowEvent;
}

void DomicilePopupWindowEvent::Trace(Visitor* visitor) const {
  Event::Trace(visitor);
}

}  // namespace blink
