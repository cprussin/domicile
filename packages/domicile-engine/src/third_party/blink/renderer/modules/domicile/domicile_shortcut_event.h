// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHORTCUT_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHORTCUT_EVENT_H_

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
                        bool meta);
  ~DomicileShortcutEvent() override;

  uint32_t keycode() const { return keycode_; }
  bool altKey() const { return alt_; }
  bool ctrlKey() const { return ctrl_; }
  bool shiftKey() const { return shift_; }
  bool metaKey() const { return meta_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  uint32_t keycode_ = 0;
  bool alt_ = false;
  bool ctrl_ = false;
  bool shift_ = false;
  bool meta_ = false;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHORTCUT_EVENT_H_
