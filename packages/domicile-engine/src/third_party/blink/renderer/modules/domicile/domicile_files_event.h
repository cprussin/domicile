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

// What there is to open, answering DomicileHost::listFiles().
//
// The one event on this channel that answers a question rather than reporting
// something a client did. It is an event and not a promise because everything
// else here is: a shell registers one listener per message type through
// `DomicileClient`, whose hold covers the gap between the call and the
// handler, and a promise would be a second delivery mechanism for one message.
//
// The paths are relative to the home directory and already sorted -- see the
// IDL, and `domicile_host::files` in the compositor, which is where the walk
// and the order are decided.
class MODULES_EXPORT DomicileFilesEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileFilesEvent* Create(const AtomicString& type,
                                    const DomicileFilesEventInit* initializer);

  DomicileFilesEvent(const AtomicString& type,
                     const DomicileFilesEventInit* initializer);
  DomicileFilesEvent(const AtomicString& type,
                     Vector<String> files,
                     DOMHighResTimeStamp arrival);
  ~DomicileFilesEvent() override;

  const FrozenArray<IDLString>& files() const { return *files_; }

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
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_FILES_EVENT_H_
