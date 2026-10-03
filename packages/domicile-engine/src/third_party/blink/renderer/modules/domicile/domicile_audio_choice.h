// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_CHOICE_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_CHOICE_H_

#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// A port of a device or a profile of a card, as the compositor described it.
// Immutable, for DomicileTrayItem's reason.
class MODULES_EXPORT DomicileAudioChoice final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileAudioChoice(const String& name,
                      const String& description,
                      bool available);
  ~DomicileAudioChoice() override;

  const String& name() const { return name_; }
  const String& description() const { return description_; }
  bool available() const { return available_; }

  void Trace(Visitor*) const override;

 private:
  String name_;
  String description_;
  bool available_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_CHOICE_H_
