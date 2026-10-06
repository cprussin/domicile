// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_DEVICE_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_DEVICE_H_

#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/modules/domicile/domicile_audio_choice.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/heap/collection_support/heap_vector.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// An audio output or input, as reported by the compositor. Immutable: the
// compositor resends the whole state on any change.
class MODULES_EXPORT DomicileAudioDevice final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileAudioDevice(const String& id,
                      const String& description,
                      double volume,
                      bool muted,
                      bool is_default,
                      bool monitor,
                      HeapVector<Member<DomicileAudioChoice>> ports,
                      const String& port);
  ~DomicileAudioDevice() override;

  const String& id() const { return id_; }
  const String& description() const { return description_; }
  double volume() const { return volume_; }
  bool muted() const { return muted_; }
  bool isDefault() const { return is_default_; }
  bool monitor() const { return monitor_; }
  const FrozenArray<DomicileAudioChoice>& ports() const { return *ports_; }
  const String& port() const { return port_; }

  void Trace(Visitor*) const override;

 private:
  String id_;
  String description_;
  double volume_;
  bool muted_;
  bool is_default_;
  bool monitor_;
  Member<FrozenArray<DomicileAudioChoice>> ports_;
  String port_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_DEVICE_H_
