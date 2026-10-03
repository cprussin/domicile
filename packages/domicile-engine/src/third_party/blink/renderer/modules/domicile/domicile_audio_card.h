// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_CARD_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_CARD_H_

#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/modules/domicile/domicile_audio_choice.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/heap/collection_support/heap_vector.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// A sound card and its profiles, as the compositor described it. Immutable,
// for DomicileTrayItem's reason.
class MODULES_EXPORT DomicileAudioCard final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileAudioCard(const String& id,
                    const String& description,
                    HeapVector<Member<DomicileAudioChoice>> profiles,
                    const String& profile);
  ~DomicileAudioCard() override;

  const String& id() const { return id_; }
  const String& description() const { return description_; }
  const FrozenArray<DomicileAudioChoice>& profiles() const {
    return *profiles_;
  }
  const String& profile() const { return profile_; }

  void Trace(Visitor*) const override;

 private:
  String id_;
  String description_;
  Member<FrozenArray<DomicileAudioChoice>> profiles_;
  String profile_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_CARD_H_
