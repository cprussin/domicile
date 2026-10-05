// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_EVENT_H_

#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

class DomicileAppEventInit;

// A client asked for the keyboard: `focusrequested`, a moment with no
// attribute to read late. Which window, and nothing else -- what the windows
// are is `DomicileHost.windows`.
class MODULES_EXPORT DomicileAppEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileAppEvent* Create(const AtomicString& type,
                                  const DomicileAppEventInit* initializer);

  DomicileAppEvent(const AtomicString& type,
                   const DomicileAppEventInit* initializer);
  DomicileAppEvent(const AtomicString& type, const String& app_id);
  ~DomicileAppEvent() override;

  const String& appId() const { return app_id_; }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  String app_id_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_EVENT_H_
