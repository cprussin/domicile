// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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

// What has been copied on this desktop, newest first.
//
// Pushed, so there is nothing on DomicileHost this answers: a copy is
// wl_data_device.set_selection arriving at the compositor, which is an event
// it already hears. It is sent whenever the history changes and once more to a
// page that has just connected.
//
// A PAGE CANNOT READ THIS FOR ITSELF, and navigator.clipboard is the trap that
// looks like it can: that API answers out of this browser's own clipboard,
// which on the platform this engine scans out on is connected to no Wayland
// client at all. A shell reading it would see what the shell copied and
// nothing any window did.
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

  // When the browser process had this, on `performance.now()`'s clock. See
  // DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  // Frozen because the IDL says so, and never null: both constructors build
  // one, an empty history included. An absent list and an empty one are the
  // same answer here -- a desktop nothing has been copied on -- which is why
  // the compositor sends this message with no rows in it rather than not
  // sending it.
  Member<FrozenArray<DomicileClipboardEntry>> entries_;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_CLIPBOARD_EVENT_H_
