// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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

// What there is to open, answering DomicileHost::listFiles() and also arriving
// unasked.
//
// The one event on this channel that answers a question at all. It is an event
// and not a promise because everything else here is: a shell registers one
// listener per message type through `DomicileClient`, whose hold covers the
// gap between the call and the handler, and a promise would be a second
// delivery mechanism for one message. That shape is also what lets the
// compositor send this on its own, which it does whenever the index behind the
// list changes -- a promise would have had nowhere to put those.
//
// The paths are relative to the home directory and already sorted -- see the
// IDL, and `domicile_host::file_index` in the compositor, which is where the
// list is kept and the order is decided.
class MODULES_EXPORT DomicileFilesEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileFilesEvent* Create(const AtomicString& type,
                                    const DomicileFilesEventInit* initializer);

  DomicileFilesEvent(const AtomicString& type,
                     const DomicileFilesEventInit* initializer);
  DomicileFilesEvent(const AtomicString& type,
                     Vector<String> files,
                     bool indexing,
                     DOMHighResTimeStamp arrival);
  ~DomicileFilesEvent() override;

  const FrozenArray<IDLString>& files() const { return *files_; }

  // Whether the index this list came out of is still being built. See the IDL:
  // an incomplete answer that did not say so would read as a complete one.
  bool indexing() const { return indexing_; }

  // When the browser process had this, on `performance.now()`'s clock. See
  // DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  // Frozen because the IDL says so, and never null: both constructors build
  // one, an empty home included. An absent list and an empty one are the same
  // answer here -- a home with nothing to offer -- because the compositor does
  // not send this message at all when it has nothing to say.
  Member<FrozenArray<IDLString>> files_;
  // False by default, which is "this is the whole home": the state a list is
  // in for all but the first seconds of a session, and the reading an event
  // built without the field should get.
  bool indexing_ = false;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_FILES_EVENT_H_
