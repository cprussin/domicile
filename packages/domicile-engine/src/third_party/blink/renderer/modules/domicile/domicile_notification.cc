// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_notification.h"

#include <utility>

namespace blink {

DomicileNotification::DomicileNotification(
    uint32_t id,
    const String& app_name,
    const String& summary,
    const String& body,
    const String& icon,
    const String& urgency,
    HeapVector<Member<DomicileNotificationAction>> actions,
    bool clickable,
    int32_t timeout_ms,
    double time)
    : id_(id),
      app_name_(app_name),
      summary_(summary),
      body_(body),
      icon_(icon),
      urgency_(urgency),
      actions_(MakeGarbageCollected<FrozenArray<DomicileNotificationAction>>(
          std::move(actions))),
      clickable_(clickable),
      timeout_ms_(timeout_ms),
      time_(time) {}

DomicileNotification::~DomicileNotification() = default;

void DomicileNotification::Trace(Visitor* visitor) const {
  visitor->Trace(actions_);
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
