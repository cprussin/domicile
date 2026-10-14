// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_DIALOG_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_DIALOG_EVENT_H_

#include "components/domicile/mojom/web_view_guest.mojom-blink.h"
#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/dom/events/event.h"
#include "third_party/blink/renderer/platform/heap/member.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

class ExceptionState;
class HTMLWebViewElement;

// Asks the shell to show the `alert()`, `confirm()` or `prompt()` the page
// inside a <webview> opened, or whether to leave a page whose `beforeunload`
// asked to stay.
//
// - Carries the browser's reply callback, as DomicilePermissionRequestEvent
//   does. The browser expects one answer, so a second throws
//   InvalidStateError.
// - A shell claims it with `preventDefault()`. The element answers an
//   unclaimed one after dispatch (AnswerUnclaimed), so a shell that does not
//   listen leaves the page running as if Cancel were pressed, and leaves a
//   page that asked to stay as if there were no dialog manager.
// - The element holds it until answered or withdrawn. Garbage collection
//   would otherwise drop the callback unrun.
class CORE_EXPORT DomicileDialogEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  using Answer =
      domicile::mojom::blink::WebViewGuestClient::DialogRequestedCallback;

  DomicileDialogEvent(const AtomicString& type,
                      domicile::mojom::blink::WebViewDialogType dialog_type,
                      const String& origin,
                      const String& message,
                      const String& default_value,
                      Answer answer,
                      HTMLWebViewElement& owner);
  ~DomicileDialogEvent() override;

  String dialogType() const;
  const String& origin() const { return origin_; }
  const String& message() const { return message_; }
  const String& defaultValue() const { return default_value_; }

  void accept(const String& value, ExceptionState&);
  void dismiss(ExceptionState&);

  // Called by the element when the browser withdraws the dialog, and for a
  // stale one. Answers Cancel.
  void DismissIfUnanswered();

  // Called by the element for an event no shell claimed: Cancel, or Leave for
  // a `beforeunload`, so a shell that draws no dialog never traps a page.
  void AnswerUnclaimed();

  const AtomicString& InterfaceName() const override;

  void Trace(Visitor*) const override;

 private:
  void Run(bool accepted, const String& value);

  domicile::mojom::blink::WebViewDialogType dialog_type_;
  String origin_;
  String message_;
  String default_value_;
  // Null once answered.
  Answer answer_;
  // Notified on answer so it releases this event.
  Member<HTMLWebViewElement> owner_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_DIALOG_EVENT_H_
