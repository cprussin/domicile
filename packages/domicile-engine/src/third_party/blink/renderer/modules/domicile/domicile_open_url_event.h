// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_OPEN_URL_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_OPEN_URL_EVENT_H_

#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

class DomicileOpenUrlEventInit;

// An address somebody asked this desktop to open: `domicile open-url`, which
// is what `BROWSER` runs inside it.
class MODULES_EXPORT DomicileOpenUrlEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileOpenUrlEvent* Create(
      const AtomicString& type,
      const DomicileOpenUrlEventInit* initializer);

  DomicileOpenUrlEvent(const AtomicString& type,
                       const DomicileOpenUrlEventInit* initializer);
  DomicileOpenUrlEvent(const AtomicString& type, const String& url);
  ~DomicileOpenUrlEvent() override;

  const String& url() const { return url_; }

  const AtomicString& InterfaceName() const override;

 private:
  String url_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_OPEN_URL_EVENT_H_
