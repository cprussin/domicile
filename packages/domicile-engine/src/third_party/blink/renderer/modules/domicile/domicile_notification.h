// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_NOTIFICATION_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_NOTIFICATION_H_

#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/modules/domicile/domicile_notification_action.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/heap/collection_support/heap_vector.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// One notification, as the compositor described it. Immutable: the compositor
// resends every notification whenever any of them changes.
class MODULES_EXPORT DomicileNotification final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileNotification(uint32_t id,
                       const String& app_name,
                       const String& summary,
                       const String& body,
                       const String& icon,
                       const String& urgency,
                       HeapVector<Member<DomicileNotificationAction>> actions,
                       bool clickable,
                       int32_t timeout_ms,
                       double time);
  ~DomicileNotification() override;

  uint32_t id() const { return id_; }
  const String& appName() const { return app_name_; }
  const String& summary() const { return summary_; }
  const String& body() const { return body_; }
  const String& icon() const { return icon_; }
  const String& urgency() const { return urgency_; }
  const FrozenArray<DomicileNotificationAction>& actions() const {
    return *actions_;
  }
  bool clickable() const { return clickable_; }
  int32_t timeoutMs() const { return timeout_ms_; }
  double time() const { return time_; }

  void Trace(Visitor*) const override;

 private:
  uint32_t id_;
  String app_name_;
  String summary_;
  String body_;
  // A `data:` URL, or empty for nothing to draw.
  String icon_;
  String urgency_;
  // Frozen per the IDL, and never null.
  Member<FrozenArray<DomicileNotificationAction>> actions_;
  bool clickable_;
  int32_t timeout_ms_;
  double time_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_NOTIFICATION_H_
