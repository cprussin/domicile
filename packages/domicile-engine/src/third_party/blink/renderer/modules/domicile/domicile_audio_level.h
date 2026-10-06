// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_LEVEL_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_LEVEL_H_

#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// One meter reading, as the compositor described it. Immutable.
class MODULES_EXPORT DomicileAudioLevel final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileAudioLevel(const String& id, double peak);
  ~DomicileAudioLevel() override;

  const String& id() const { return id_; }
  double peak() const { return peak_; }

  void Trace(Visitor*) const override;

 private:
  String id_;
  double peak_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_LEVEL_H_
