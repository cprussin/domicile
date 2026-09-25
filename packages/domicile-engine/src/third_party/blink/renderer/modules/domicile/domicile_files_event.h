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

// What a search of the home found, answering DomicileHost::searchFiles().
//
// The one event on this channel that answers a question at all. It is an event
// and not a promise because everything else here is; the query it carries is
// what lets `DomicileClient` settle the search that asked it.
//
// The paths are relative to the home directory and already sorted -- see the
// IDL, and `domicile_host::file_search` in the compositor, which is where the
// matching is done.
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

  // Whether the index this was found in is still being built. See the IDL: an
  // incomplete answer that did not say so would read as a complete one.
  bool indexing() const { return indexing_; }

  // When the browser process had this, on `performance.now()`'s clock. See
  // DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  String query_;
  // Frozen because the IDL says so, and never null: both constructors build
  // one, an empty answer included. An absent list and an empty one are the
  // same answer here -- nothing matched -- because the compositor does not
  // send this message at all when it has nothing to say.
  Member<FrozenArray<IDLString>> files_;
  uint32_t matched_ = 0;
  bool indexing_ = false;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_FILES_EVENT_H_
