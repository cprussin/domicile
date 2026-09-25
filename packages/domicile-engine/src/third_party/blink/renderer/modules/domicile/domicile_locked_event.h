// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_LOCKED_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_LOCKED_EVENT_H_

#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"

namespace blink {

class DomicileLockedEventInit;

// Whether this desk is locked.
//
// Pushed rather than asked for, like DomicileIdleEvent -- and unlike it in the
// one way that matters: the compositor holds this state, and nothing in this
// renderer can change it. Every key and every pointer event on this desktop is
// forwarded by the shell and injected into a Wayland seat by the compositor,
// and while this is true the injection does not happen. So a page reload does
// not open the desk, and neither does a page edited in the devtools of the
// browser drawing it; what a shell draws over a locked desktop is a surface
// over a desktop that has already stopped listening.
//
// The page keeps its own keys throughout, which is what makes a lock screen
// possible: the page is the thing forwarding, so it can take a passphrase while
// nothing it forwards reaches a client. DomicileHost::unlock() is how it offers
// one, and the answer is another one of these rather than a return value.
//
// A state and not an edge, for the reason DomicileIdleEvent is one with the
// stakes the other way up: a page that has just loaded has missed every edge
// there was, and the edge it missed is the one that would have raised its lock
// screen.
class MODULES_EXPORT DomicileLockedEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileLockedEvent* Create(
      const AtomicString& type,
      const DomicileLockedEventInit* initializer);

  DomicileLockedEvent(const AtomicString& type,
                      const DomicileLockedEventInit* initializer);
  DomicileLockedEvent(const AtomicString& type,
                      bool locked,
                      DOMHighResTimeStamp arrival);
  ~DomicileLockedEvent() override;

  bool locked() const { return locked_; }

  // When the browser process had this, on `performance.now()`'s clock. See
  // DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;

 private:
  // A plain bool rather than anything nullable: a desktop with no passphrase
  // configured cannot lock and sends no message at all, so there is no "nobody
  // has said" for this event to represent. Every one of these is an answer.
  bool locked_ = false;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_LOCKED_EVENT_H_
