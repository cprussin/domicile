// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_LEVELS_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_LEVELS_EVENT_H_

#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/domicile/domicile_audio_level.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"

namespace blink {

class DomicileAudioLevelsEventInit;

// How loud each thing a page asked to meter is: pushed some twenty times a
// second while anything is metered. See DomicileHost::watchAudioLevels.
class MODULES_EXPORT DomicileAudioLevelsEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileAudioLevelsEvent* Create(
      const AtomicString& type,
      const DomicileAudioLevelsEventInit* initializer);

  DomicileAudioLevelsEvent(const AtomicString& type,
                           const DomicileAudioLevelsEventInit* initializer);
  DomicileAudioLevelsEvent(const AtomicString& type,
                           HeapVector<Member<DomicileAudioLevel>> levels,
                           DOMHighResTimeStamp arrival);
  ~DomicileAudioLevelsEvent() override;

  const FrozenArray<DomicileAudioLevel>& levels() const { return *levels_; }

  // When the browser process had this, on `performance.now()`'s clock. See
  // DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  // Frozen because the IDL says so, and never null.
  Member<FrozenArray<DomicileAudioLevel>> levels_;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_LEVELS_EVENT_H_
