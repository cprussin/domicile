// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_MODIFIERS_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_MODIFIERS_EVENT_H_

#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"

namespace blink {

class DomicileModifiersEventInit;

// The seat's modifier state.
//
// Its own type rather than four numbers smuggled through fields named for
// something else. The state matters because there is one seat and it outlives
// every window: a press whose release the compositor never sees stays down in
// it for good, and under caps:swapescape that latches capitals into every
// Wayland client opened afterwards. A shell resyncing from this needs the four
// values to mean what xkb says they mean.
class MODULES_EXPORT DomicileModifiersEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileModifiersEvent* Create(
      const AtomicString& type,
      const DomicileModifiersEventInit* initializer);

  DomicileModifiersEvent(const AtomicString& type,
                         const DomicileModifiersEventInit* initializer);
  DomicileModifiersEvent(const AtomicString& type,
                         uint32_t depressed,
                         uint32_t latched,
                         uint32_t locked,
                         uint32_t group);
  ~DomicileModifiersEvent() override;

  uint32_t depressed() const { return depressed_; }
  uint32_t latched() const { return latched_; }
  uint32_t locked() const { return locked_; }
  uint32_t group() const { return group_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  uint32_t depressed_ = 0;
  uint32_t latched_ = 0;
  uint32_t locked_ = 0;
  uint32_t group_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_MODIFIERS_EVENT_H_
