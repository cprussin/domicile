// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CLIPBOARD_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CLIPBOARD_EVENT_H_

#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/domicile/domicile_clipboard_entry.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"

namespace blink {

class DomicileClipboardEventInit;

// The clipboard history, newest first.
//
// Push-only: the compositor sees every wl_data_device.set_selection, and sends
// this on each change and once to a newly connected page.
//
// Pages cannot use navigator.clipboard for this: it reads this browser's own
// clipboard, which is connected to no Wayland client, so it shows only what
// the shell copied.
class MODULES_EXPORT DomicileClipboardEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileClipboardEvent* Create(
      const AtomicString& type,
      const DomicileClipboardEventInit* initializer);

  DomicileClipboardEvent(const AtomicString& type,
                         const DomicileClipboardEventInit* initializer);
  DomicileClipboardEvent(const AtomicString& type,
                         HeapVector<Member<DomicileClipboardEntry>> entries,
                         DOMHighResTimeStamp arrival);
  ~DomicileClipboardEvent() override;

  const FrozenArray<DomicileClipboardEntry>& entries() const {
    return *entries_;
  }

  // When the browser process received this, on `performance.now()`'s clock.
  // See DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  // Frozen per the IDL, and never null. An empty history is sent as an empty
  // list, not omitted.
  Member<FrozenArray<DomicileClipboardEntry>> entries_;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CLIPBOARD_EVENT_H_
