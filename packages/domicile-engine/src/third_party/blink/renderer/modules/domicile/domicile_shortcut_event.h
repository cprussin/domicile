// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHORTCUT_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHORTCUT_EVENT_H_

#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

class DomicileShortcutEventInit;

// A grabbed key combination was pressed.
//
// Its own type because a shortcut belongs to no window: it fires regardless of
// which window has keyboard focus.
class MODULES_EXPORT DomicileShortcutEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileShortcutEvent* Create(
      const AtomicString& type,
      const DomicileShortcutEventInit* initializer);

  DomicileShortcutEvent(const AtomicString& type,
                        const DomicileShortcutEventInit* initializer);
  DomicileShortcutEvent(const AtomicString& type,
                        const String& chord,
                        uint32_t keycode,
                        bool alt,
                        bool ctrl,
                        bool shift,
                        bool meta,
                        DOMHighResTimeStamp arrival);
  ~DomicileShortcutEvent() override;

  const String& chord() const { return chord_; }
  uint32_t keycode() const { return keycode_; }
  bool altKey() const { return alt_; }
  bool ctrlKey() const { return ctrl_; }
  bool shiftKey() const { return shift_; }
  bool metaKey() const { return meta_; }

  // When the browser process received this, on `performance.now()`'s clock.
  //
  // A chord the shell grabbed is matched in the browser process and never
  // crosses the compositor's socket; it is stamped when the match reaches the
  // control channel. See DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  String chord_;
  uint32_t keycode_ = 0;
  bool alt_ = false;
  bool ctrl_ = false;
  bool shift_ = false;
  bool meta_ = false;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHORTCUT_EVENT_H_
