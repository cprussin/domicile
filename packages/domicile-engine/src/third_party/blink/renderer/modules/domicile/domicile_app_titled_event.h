// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_TITLED_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_TITLED_EVENT_H_

#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"

namespace blink {

class DomicileAppTitledEventInit;

// A window's title changed. A typed event so shells parse nothing.
class MODULES_EXPORT DomicileAppTitledEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileAppTitledEvent* Create(
      const AtomicString& type,
      const DomicileAppTitledEventInit* initializer);

  DomicileAppTitledEvent(const AtomicString& type,
                         const DomicileAppTitledEventInit* initializer);
  DomicileAppTitledEvent(const AtomicString& type,
                         const String& app_id,
                         const String& title,
                         DOMHighResTimeStamp arrival);
  ~DomicileAppTitledEvent() override;

  const String& appId() const { return app_id_; }
  const String& title() const { return title_; }

  // See DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;

  void Trace(Visitor*) const override;

 private:
  String app_id_;
  String title_;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_TITLED_EVENT_H_
