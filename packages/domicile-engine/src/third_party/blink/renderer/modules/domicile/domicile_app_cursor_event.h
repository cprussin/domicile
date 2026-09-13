// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_CURSOR_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_CURSOR_EVENT_H_

#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_cursor_shape.h"
#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"

namespace blink {

class DomicileAppCursorEventInit;

// A client asked for a cursor to be shown over its window.
//
// SPLIT OUT OF DomicileAppEvent WHEN THE SHAPE BECAME AN ENUM. The five other
// events that type carries have nothing to say about a cursor, and while this
// was a `DOMString` they said it by passing the empty string. A
// `V8DomicileCursorShape` has no such value, and inventing one -- a nullable
// attribute, a `kNone` that means "no cursor event" rather than "hide the
// cursor", which is a shape the compositor really can send -- would put the
// sentinel back wearing a type. A separate event says it in the type system
// instead: this one always carries a shape, and the others cannot be asked.
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

  // When the browser process had this, on `performance.now()`'s clock. See
  // DomicileAppEvent::arrival.
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
