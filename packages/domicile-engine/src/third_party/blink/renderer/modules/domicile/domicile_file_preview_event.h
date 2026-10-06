// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_FILE_PREVIEW_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_FILE_PREVIEW_EVENT_H_

#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

class DomicileFilePreviewEventInit;

// The contents of one file, answering DomicileHost::previewFile().
//
// An event, not a promise, to match the rest of this channel. The path lets
// `DomicileClient` resolve the matching request.
//
// `kind` says which of `text` and `entries` applies; see the IDL.
class MODULES_EXPORT DomicileFilePreviewEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileFilePreviewEvent* Create(
      const AtomicString& type,
      const DomicileFilePreviewEventInit* initializer);

  DomicileFilePreviewEvent(const AtomicString& type,
                           const DomicileFilePreviewEventInit* initializer);
  DomicileFilePreviewEvent(const AtomicString& type,
                           String path,
                           String kind,
                           String text,
                           Vector<String> entries,
                           String title,
                           String artist,
                           String album,
                           double duration,
                           String cover,
                           DOMHighResTimeStamp arrival);
  ~DomicileFilePreviewEvent() override;

  const String& path() const { return path_; }
  const String& kind() const { return kind_; }
  const String& text() const { return text_; }
  const FrozenArray<IDLString>& entries() const { return *entries_; }
  const String& title() const { return title_; }
  const String& artist() const { return artist_; }
  const String& album() const { return album_; }
  double duration() const { return duration_; }
  const String& cover() const { return cover_; }

  // When the browser process received this, on `performance.now()`'s clock.
  // See DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  String path_;
  String kind_;
  String text_;
  // Frozen per the IDL, and never null. Empty for every kind but a directory.
  Member<FrozenArray<IDLString>> entries_;
  // Audio tags. Empty, and zero, for every kind but audio.
  String title_;
  String artist_;
  String album_;
  double duration_ = 0;
  String cover_;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_FILE_PREVIEW_EVENT_H_
