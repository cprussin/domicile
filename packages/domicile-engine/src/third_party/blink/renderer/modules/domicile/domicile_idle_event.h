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

// Whether anybody is at this desktop.
//
// Pushed rather than asked for, like DomicileBatteryEvent: the compositor is
// the process every key and every pointer movement on this desktop passes
// through, so it is the only thing that can count hands -- see `crate::idle`
// on that side. A page cannot count them for itself, and the web platform's
// own idle signals are worse than useless here: a shell is the desktop, so its
// document stays visible with the glass off and every one of them reads
// "somebody is here" on a desk nobody has been at for an hour.
//
// The boolean is a state and not an edge, which is the one design decision in
// this class: a page reloads, and one that has just loaded has missed every
// edge there was, so the compositor repeats where the desk stands to a chrome
// that has only just connected.
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

  // When the browser process had this, on `performance.now()`'s clock. See
  // DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;

 private:
  // A plain bool rather than anything nullable: a desktop with no idle timeout
  // sends no message at all, so there is no "nobody has said" for this event
  // to represent. Every one of these is an answer.
  bool idle_ = false;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_IDLE_EVENT_H_
