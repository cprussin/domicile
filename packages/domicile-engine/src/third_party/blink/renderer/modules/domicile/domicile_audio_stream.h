// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_STREAM_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_STREAM_H_

#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// Something playing or recording, as the compositor described it.
// Immutable, for DomicileTrayItem's reason.
class MODULES_EXPORT DomicileAudioStream final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileAudioStream(const String& id,
                      const String& application,
                      const String& title,
                      double volume,
                      bool muted,
                      const String& device);
  ~DomicileAudioStream() override;

  const String& id() const { return id_; }
  const String& application() const { return application_; }
  const String& title() const { return title_; }
  double volume() const { return volume_; }
  bool muted() const { return muted_; }
  const String& device() const { return device_; }

  void Trace(Visitor*) const override;

 private:
  String id_;
  String application_;
  String title_;
  double volume_;
  bool muted_;
  String device_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_AUDIO_STREAM_H_
