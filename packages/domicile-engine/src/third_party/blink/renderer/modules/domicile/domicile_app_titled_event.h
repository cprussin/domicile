// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_TITLED_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_TITLED_EVENT_H_

#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"

namespace blink {

class DomicileAppTitledEventInit;

// A window's title changed.
//
// A real event type rather than a CustomEvent carrying a detail bag: the point
// of the typed surface is that a shell parses nothing, and a detail bag would
// put the parsing back where it was.
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

  // When the browser process had this, on `performance.now()`'s clock. See
  // DomicileAppEvent::arrival.
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
