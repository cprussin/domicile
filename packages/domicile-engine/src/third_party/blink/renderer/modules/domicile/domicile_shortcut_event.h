// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHORTCUT_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHORTCUT_EVENT_H_

#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"

namespace blink {

class DomicileShortcutEventInit;

// A grabbed key combination fired.
//
// Its own type rather than a DomicileAppEvent carrying the combination in the
// field named `title`. A shortcut has no window: it is delivered whatever holds
// the keyboard, which is the reason to grab one at all, and an event that says
// which window it happened to would be answering a question that has no answer.
class MODULES_EXPORT DomicileShortcutEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileShortcutEvent* Create(
      const AtomicString& type,
      const DomicileShortcutEventInit* initializer);

  DomicileShortcutEvent(const AtomicString& type,
                        const DomicileShortcutEventInit* initializer);
  DomicileShortcutEvent(const AtomicString& type,
                        uint32_t keycode,
                        bool alt,
                        bool ctrl,
                        bool shift,
                        bool meta,
                        DOMHighResTimeStamp arrival);
  ~DomicileShortcutEvent() override;

  uint32_t keycode() const { return keycode_; }
  bool altKey() const { return alt_; }
  bool ctrlKey() const { return ctrl_; }
  bool shiftKey() const { return shift_; }
  bool metaKey() const { return meta_; }

  // When the browser process had this, on `performance.now()`'s clock.
  //
  // This is the one event here whose `arrival` is not always a socket read: a
  // chord the shell claimed is matched in the browser process and never
  // crosses the compositor's socket. It is stamped when that match reaches the
  // control channel, which is the same quantity on the same clock. See
  // DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  uint32_t keycode_ = 0;
  bool alt_ = false;
  bool ctrl_ = false;
  bool shift_ = false;
  bool meta_ = false;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHORTCUT_EVENT_H_
