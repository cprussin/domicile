// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_PROMPT_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_PROMPT_EVENT_H_

#include "components/domicile/mojom/web_view_guest.mojom-blink.h"
#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/dom/events/event.h"
#include "third_party/blink/renderer/platform/heap/member.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"

namespace blink {

class ExceptionState;
class HTMLWebViewElement;

// Asks the shell a question Chrome would ask with a dialog of its own, for
// the page inside a <webview> or an extension shown in it.
//
// - Carries the browser's reply callback, as DomicileDialogEvent does. The
//   browser expects one answer, so a second throws InvalidStateError.
// - A shell claims it with `preventDefault()`. The element dismisses an
//   unclaimed one after dispatch, so a shell that does not listen answers no.
// - The element holds it until answered, withdrawn or replaced. Garbage
//   collection would otherwise drop the callback unrun.
class CORE_EXPORT DomicilePromptEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  using Answer =
      domicile::mojom::blink::WebViewGuestClient::PromptRequestedCallback;

  DomicilePromptEvent(const AtomicString& type,
                      const domicile::mojom::blink::WebViewPrompt& prompt,
                      Answer answer,
                      HTMLWebViewElement& owner);
  ~DomicilePromptEvent() override;

  const String& kind() const { return kind_; }
  const String& origin() const { return origin_; }
  const String& subject() const { return subject_; }
  const Vector<String>& details() const { return details_; }
  const String& pin() const { return pin_; }

  void accept(int32_t choice, const String& text, ExceptionState&);
  void dismiss(ExceptionState&);

  // Called by the element for an unclaimed event, a withdrawn one and one a
  // newer prompt replaced. Answers no.
  void DismissIfUnanswered();

  const AtomicString& InterfaceName() const override;

  void Trace(Visitor*) const override;

 private:
  void Run(bool accepted, int32_t choice, const String& text);

  String kind_;
  String origin_;
  String subject_;
  Vector<String> details_;
  String pin_;
  // Null once answered.
  Answer answer_;
  // Notified on answer so it releases this event.
  Member<HTMLWebViewElement> owner_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_PROMPT_EVENT_H_
