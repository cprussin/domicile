// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_MODIFIERS_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_MODIFIERS_EVENT_H_

#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"

namespace blink {

class DomicileModifiersEventInit;

// The seat's modifier state.
//
// A shell uses this to resync modifiers: the seat outlives every window, so a
// press whose release the compositor never sees stays down for every client.
class MODULES_EXPORT DomicileModifiersEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileModifiersEvent* Create(
      const AtomicString& type,
      const DomicileModifiersEventInit* initializer);

  DomicileModifiersEvent(const AtomicString& type,
                         const DomicileModifiersEventInit* initializer);
  DomicileModifiersEvent(const AtomicString& type,
                         bool alt,
                         bool ctrl,
                         bool shift,
                         bool meta,
                         DOMHighResTimeStamp arrival);
  ~DomicileModifiersEvent() override;

  bool altKey() const { return alt_; }
  bool ctrlKey() const { return ctrl_; }
  bool shiftKey() const { return shift_; }
  bool metaKey() const { return meta_; }

  // When the browser process received this, on `performance.now()`'s clock.
  // See DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  bool alt_ = false;
  bool ctrl_ = false;
  bool shift_ = false;
  bool meta_ = false;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_MODIFIERS_EVENT_H_
