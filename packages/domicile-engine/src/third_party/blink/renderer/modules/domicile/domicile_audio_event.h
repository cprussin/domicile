// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_EVENT_H_

#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/domicile/domicile_audio_card.h"
#include "third_party/blink/renderer/modules/domicile/domicile_audio_device.h"
#include "third_party/blink/renderer/modules/domicile/domicile_audio_stream.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"

namespace blink {

class DomicileAudioEventInit;

// The desk's sound: every output and input, every stream playing or
// recording, every sound card.
//
// Pushed, like DomicileNotificationsEvent, so there is nothing on
// DomicileHost this answers by itself: it is sent whenever the sound server
// says something moved -- the mixer's own requests included -- and once more
// to a page that has just connected.
class MODULES_EXPORT DomicileAudioEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileAudioEvent* Create(const AtomicString& type,
                                    const DomicileAudioEventInit* initializer);

  DomicileAudioEvent(const AtomicString& type,
                     const DomicileAudioEventInit* initializer);
  DomicileAudioEvent(const AtomicString& type,
                     HeapVector<Member<DomicileAudioDevice>> outputs,
                     HeapVector<Member<DomicileAudioDevice>> inputs,
                     HeapVector<Member<DomicileAudioStream>> playback,
                     HeapVector<Member<DomicileAudioStream>> recording,
                     HeapVector<Member<DomicileAudioCard>> cards,
                     DOMHighResTimeStamp arrival);
  ~DomicileAudioEvent() override;

  const FrozenArray<DomicileAudioDevice>& outputs() const { return *outputs_; }
  const FrozenArray<DomicileAudioDevice>& inputs() const { return *inputs_; }
  const FrozenArray<DomicileAudioStream>& playback() const {
    return *playback_;
  }
  const FrozenArray<DomicileAudioStream>& recording() const {
    return *recording_;
  }
  const FrozenArray<DomicileAudioCard>& cards() const { return *cards_; }

  // When the browser process had this, on `performance.now()`'s clock. See
  // DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  // Frozen because the IDL says so, and never null: both constructors build
  // each, empty included.
  Member<FrozenArray<DomicileAudioDevice>> outputs_;
  Member<FrozenArray<DomicileAudioDevice>> inputs_;
  Member<FrozenArray<DomicileAudioStream>> playback_;
  Member<FrozenArray<DomicileAudioStream>> recording_;
  Member<FrozenArray<DomicileAudioCard>> cards_;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_EVENT_H_
