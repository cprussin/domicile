// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APPS_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APPS_EVENT_H_

#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
#include "third_party/blink/renderer/modules/domicile/domicile_desktop_entry.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

class DomicileAppsEventInit;

// The applications a search matched, answering DomicileHost::searchApps().
//
// An event and not a promise for DomicileFilesEvent's reason; the query it
// carries is what lets `DomicileClient` settle the search that asked it.
class MODULES_EXPORT DomicileAppsEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileAppsEvent* Create(const AtomicString& type,
                                   const DomicileAppsEventInit* initializer);

  DomicileAppsEvent(const AtomicString& type,
                    const DomicileAppsEventInit* initializer);
  DomicileAppsEvent(const AtomicString& type,
                    String query,
                    HeapVector<Member<DomicileDesktopEntry>> apps,
                    DOMHighResTimeStamp arrival);
  ~DomicileAppsEvent() override;

  const String& query() const { return query_; }
  const FrozenArray<DomicileDesktopEntry>& apps() const { return *apps_; }

  // When the browser process had this, on `performance.now()`'s clock. See
  // DomicileAppEvent::arrival.
  DOMHighResTimeStamp arrival() const { return arrival_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  String query_;
  // Frozen because the IDL says so, and never null: both constructors build
  // one, an empty answer included.
  Member<FrozenArray<DomicileDesktopEntry>> apps_;
  DOMHighResTimeStamp arrival_ = 0;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APPS_EVENT_H_
