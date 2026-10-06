// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_CURSOR_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_CURSOR_EVENT_H_

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_cursor_shape.h"
#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"

namespace blink {

class DomicileAppCursorEventInit;

// A client set the cursor shown over its window.
//
// Separate from DomicileAppEvent so `cursor` is always a valid shape, with no
// sentinel for events that carry none.
class MODULES_EXPORT DomicileAppCursorEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileAppCursorEvent* Create(
      const AtomicString& type,
      const DomicileAppCursorEventInit* initializer);

  DomicileAppCursorEvent(const AtomicString& type,
                         const DomicileAppCursorEventInit* initializer);
  DomicileAppCursorEvent(const AtomicString& type,
                         const String& app_id,
                         V8DomicileCursorShape cursor,
                         DOMHighResTimeStamp arrival);
  ~DomicileAppCursorEvent() override;

  const String& appId() const { return app_id_; }
  V8DomicileCursorShape cursor() const { return cursor_; }

  // See DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;

  void Trace(Visitor*) const override;

 private:
  String app_id_;
  V8DomicileCursorShape cursor_;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_CURSOR_EVENT_H_
