// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/html/domicile/domicile_new_window_event.h"

#include "third_party/blink/renderer/core/event_interface_names.h"

namespace blink {

// BUBBLES, AND THAT IS THE HALF THAT MAKES IT USABLE: a chrome hangs one
// handler on the window it drew and hears everything that window's parts say
// through it, which is what `BrowserWindow.tsx` in the Domicile repository
// does with the element's other three events.
//
// NOT CANCELABLE. `preventDefault()` would have to mean "do not open the
// window", and there is no window to not open: the browser process has already
// refused the one content would have made, and the one the user gets is a
// window the shell opens because it read this. A shell that does not want the
// window does not open it.
DomicileNewWindowEvent::DomicileNewWindowEvent(const AtomicString& type,
                                               const String& url)
    : Event(type, Bubbles::kYes, Cancelable::kNo), url_(url) {}

DomicileNewWindowEvent::~DomicileNewWindowEvent() = default;

const AtomicString& DomicileNewWindowEvent::InterfaceName() const {
  return event_interface_names::kDomicileNewWindowEvent;
}

void DomicileNewWindowEvent::Trace(Visitor* visitor) const {
  Event::Trace(visitor);
}

}  // namespace blink
