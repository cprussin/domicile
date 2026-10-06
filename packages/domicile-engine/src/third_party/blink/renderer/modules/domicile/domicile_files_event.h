// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_FILES_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_FILES_EVENT_H_

#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

class DomicileFilesEventInit;

// Results of a home directory search, answering DomicileHost::searchFiles().
//
// An event, not a promise, to match the rest of this channel. The query lets
// `DomicileClient` resolve the matching search.
//
// Paths are relative to the home directory and already sorted; see the IDL
// and `domicile_host::file_search` in the compositor.
class MODULES_EXPORT DomicileFilesEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileFilesEvent* Create(const AtomicString& type,
                                    const DomicileFilesEventInit* initializer);

  DomicileFilesEvent(const AtomicString& type,
                     const DomicileFilesEventInit* initializer);
  DomicileFilesEvent(const AtomicString& type,
                     String query,
                     Vector<String> files,
                     uint32_t matched,
                     bool indexing,
                     DOMHighResTimeStamp arrival);
  ~DomicileFilesEvent() override;

  const String& query() const { return query_; }
  const FrozenArray<IDLString>& files() const { return *files_; }
  uint32_t matched() const { return matched_; }

  // Whether the index is still being built. See the IDL.
  bool indexing() const { return indexing_; }

  // When the browser process received this, on `performance.now()`'s clock.
  // See DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  String query_;
  // Frozen per the IDL, and never null. Empty means nothing matched.
  Member<FrozenArray<IDLString>> files_;
  uint32_t matched_ = 0;
  bool indexing_ = false;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_FILES_EVENT_H_
