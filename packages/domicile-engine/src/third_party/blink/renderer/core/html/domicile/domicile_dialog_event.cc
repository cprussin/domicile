// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/html/domicile/domicile_dialog_event.h"

#include <utility>

#include "base/notreached.h"

#include "third_party/blink/renderer/core/event_interface_names.h"
#include "third_party/blink/renderer/core/html/domicile/html_web_view_element.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"

namespace blink {

// Bubbles like the element's other events. Cancelable because
// `preventDefault()` claims the dialog (see the header).
DomicileDialogEvent::DomicileDialogEvent(
    const AtomicString& type,
    domicile::mojom::blink::WebViewDialogType dialog_type,
    const String& origin,
    const String& message,
    const String& default_value,
    Answer answer,
    HTMLWebViewElement& owner)
    : Event(type, Bubbles::kYes, Cancelable::kYes),
      dialog_type_(dialog_type),
      origin_(origin),
      message_(message),
      default_value_(default_value),
      answer_(std::move(answer)),
      owner_(&owner) {}

DomicileDialogEvent::~DomicileDialogEvent() = default;

// Must match WEBVIEW_DIALOG_TYPES in packages/chrome-sdk/src/webview-element.ts.
String DomicileDialogEvent::dialogType() const {
  switch (dialog_type_) {
    case domicile::mojom::blink::WebViewDialogType::kAlert:
      return "alert";
    case domicile::mojom::blink::WebViewDialogType::kConfirm:
      return "confirm";
    case domicile::mojom::blink::WebViewDialogType::kPrompt:
      return "prompt";
    case domicile::mojom::blink::WebViewDialogType::kBeforeUnload:
      return "beforeunload";
  }
  NOTREACHED();
}

void DomicileDialogEvent::accept(const String& value,
                                 ExceptionState& exception_state) {
  if (!answer_) {
    exception_state.ThrowDOMException(
        DOMExceptionCode::kInvalidStateError,
        "This dialog has already been answered or withdrawn.");
    return;
  }
  Run(true, value);
}

void DomicileDialogEvent::dismiss(ExceptionState& exception_state) {
  if (!answer_) {
    exception_state.ThrowDOMException(
        DOMExceptionCode::kInvalidStateError,
        "This dialog has already been answered or withdrawn.");
    return;
  }
  Run(false, g_empty_string);
}

void DomicileDialogEvent::DismissIfUnanswered() {
  if (answer_) {
    Run(false, g_empty_string);
  }
}

// A listener may have answered without claiming.
void DomicileDialogEvent::AnswerUnclaimed() {
  if (answer_) {
    Run(dialog_type_ ==
            domicile::mojom::blink::WebViewDialogType::kBeforeUnload,
        g_empty_string);
  }
}

// `value` is never null: Mojo's string cannot be.
void DomicileDialogEvent::Run(bool accepted, const String& value) {
  std::move(answer_).Run(accepted, value);
  owner_->DialogAnswered(*this);
  owner_ = nullptr;
}

const AtomicString& DomicileDialogEvent::InterfaceName() const {
  return event_interface_names::kDomicileDialogEvent;
}

void DomicileDialogEvent::Trace(Visitor* visitor) const {
  visitor->Trace(owner_);
  Event::Trace(visitor);
}

}  // namespace blink
