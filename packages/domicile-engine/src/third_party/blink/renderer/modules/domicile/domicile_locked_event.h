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

// Whether this desktop is locked.
//
// Pushed by the compositor, which holds the state; nothing in the renderer can
// change it. While locked, the compositor drops forwarded input instead of
// injecting it into the seat, so reloading or editing the page does not unlock
// the desktop. The page still gets its own keys, so it can draw a lock screen
// and take a passphrase for DomicileHost::unlock(). unlock() returns nothing;
// its result arrives as another of these events.
//
// The compositor resends the state to a newly connected page, so a reloaded
// page still raises its lock screen.
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

  // When the browser process received this, on `performance.now()`'s clock.
  // See DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;

 private:
  // Not nullable: a desktop with no passphrase cannot lock and sends no
  // event.
  bool locked_ = false;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_LOCKED_EVENT_H_
