// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_WILL_NAVIGATE_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_WILL_NAVIGATE_EVENT_H_

#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/dom/events/event.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// Asks the shell whether the page inside a <webview> may navigate to `url`.
//
// Answered when dispatch returns: `preventDefault()` cancels. Unlike
// DomicileDialogEvent it carries no callback, so a shell cannot answer later.
class CORE_EXPORT DomicileWillNavigateEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  DomicileWillNavigateEvent(const AtomicString& type, const String& url);
  ~DomicileWillNavigateEvent() override;

  const String& url() const { return url_; }

  const AtomicString& InterfaceName() const override;

 private:
  String url_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_WILL_NAVIGATE_EVENT_H_
