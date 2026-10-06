// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_IDLE_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_IDLE_EVENT_H_

#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"

namespace blink {

class DomicileIdleEventInit;

// Whether anyone is at this desktop.
//
// Push-only. Only the compositor sees every input event, so it tracks idle;
// see `crate::idle`. The web platform's idle signals do not work here: the
// shell's document stays visible with the screen off, so they always report
// activity.
//
// A state, not an edge: the compositor resends the current state to a newly
// connected page, which has missed any earlier edges.
class MODULES_EXPORT DomicileIdleEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileIdleEvent* Create(const AtomicString& type,
                                   const DomicileIdleEventInit* initializer);

  DomicileIdleEvent(const AtomicString& type,
                    const DomicileIdleEventInit* initializer);
  DomicileIdleEvent(const AtomicString& type,
                    bool idle,
                    DOMHighResTimeStamp arrival);
  ~DomicileIdleEvent() override;

  bool idle() const { return idle_; }

  // When the browser process received this, on `performance.now()`'s clock.
  // See DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;

 private:
  // A plain bool, not nullable: a desktop with no idle timeout sends no event.
  bool idle_ = false;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_IDLE_EVENT_H_
