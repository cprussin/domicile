// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_NOTIFICATIONS_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_NOTIFICATIONS_EVENT_H_

#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/domicile/domicile_notification.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"

namespace blink {

class DomicileNotificationsEventInit;

// The desk's notifications: every one not yet cleared, oldest first.
//
// Pushed, so there is nothing on DomicileHost this answers: a notification is
// a call to org.freedesktop.Notifications, which the compositor serves. It is
// sent whenever one arrives, is replaced or goes, and once more to a page that
// has just connected.
class MODULES_EXPORT DomicileNotificationsEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileNotificationsEvent* Create(
      const AtomicString& type,
      const DomicileNotificationsEventInit* initializer);

  DomicileNotificationsEvent(const AtomicString& type,
                             const DomicileNotificationsEventInit* initializer);
  DomicileNotificationsEvent(const AtomicString& type,
                             HeapVector<Member<DomicileNotification>> items,
                             DOMHighResTimeStamp arrival);
  ~DomicileNotificationsEvent() override;

  const FrozenArray<DomicileNotification>& items() const { return *items_; }

  // When the browser process had this, on `performance.now()`'s clock. See
  // DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  // Frozen because the IDL says so, and never null: both constructors build
  // one, an empty list included. An absent list and an empty one are the same
  // answer here -- a desk with nothing to say.
  Member<FrozenArray<DomicileNotification>> items_;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_NOTIFICATIONS_EVENT_H_
