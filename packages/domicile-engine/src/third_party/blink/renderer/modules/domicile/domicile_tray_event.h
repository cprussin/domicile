// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_TRAY_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_TRAY_EVENT_H_

#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/domicile/domicile_tray_item.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"

namespace blink {

class DomicileTrayEventInit;

// The system tray: every application showing an icon, in the order they
// registered.
//
// Pushed, so there is nothing on DomicileHost this answers: an icon is a
// StatusNotifierItem on the session bus, which the compositor hosts. It is
// sent whenever an icon arrives, leaves or changes how it looks, and once more
// to a page that has just connected.
class MODULES_EXPORT DomicileTrayEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileTrayEvent* Create(const AtomicString& type,
                                   const DomicileTrayEventInit* initializer);

  DomicileTrayEvent(const AtomicString& type,
                    const DomicileTrayEventInit* initializer);
  DomicileTrayEvent(const AtomicString& type,
                    HeapVector<Member<DomicileTrayItem>> items,
                    DOMHighResTimeStamp arrival);
  ~DomicileTrayEvent() override;

  const FrozenArray<DomicileTrayItem>& items() const { return *items_; }

  // When the browser process had this, on `performance.now()`'s clock. See
  // DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  // Frozen because the IDL says so, and never null: both constructors build
  // one, an empty tray included. An absent list and an empty one are the same
  // answer here -- a desk with no icons on it.
  Member<FrozenArray<DomicileTrayItem>> items_;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_TRAY_EVENT_H_
