// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_NOTIFICATION_ACTION_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_NOTIFICATION_ACTION_H_

#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// One button of a notification, as the compositor described it. Immutable;
// see DomicileTrayItem.
class MODULES_EXPORT DomicileNotificationAction final : public ScriptWrappable {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileNotificationAction(const String& key, const String& label);
  ~DomicileNotificationAction() override;

  const String& key() const { return key_; }
  const String& label() const { return label_; }

  void Trace(Visitor*) const override;

 private:
  String key_;
  String label_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_NOTIFICATION_ACTION_H_
