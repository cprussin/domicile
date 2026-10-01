// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_notification_action.h"

namespace blink {

DomicileNotificationAction::DomicileNotificationAction(const String& key,
                                                       const String& label)
    : key_(key), label_(label) {}

DomicileNotificationAction::~DomicileNotificationAction() = default;

void DomicileNotificationAction::Trace(Visitor* visitor) const {
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
