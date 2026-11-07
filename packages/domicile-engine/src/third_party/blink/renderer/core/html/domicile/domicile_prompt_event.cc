// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/html/domicile/domicile_prompt_event.h"

#include <utility>

#include "base/notreached.h"

#include "third_party/blink/renderer/core/event_interface_names.h"
#include "third_party/blink/renderer/core/html/domicile/html_web_view_element.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"
#include "third_party/blink/renderer/platform/weborigin/security_origin.h"

namespace blink {

namespace {

constexpr char kAnswered[] =
    "This request has already been answered or withdrawn.";

using Kind = domicile::mojom::blink::WebViewPromptKind;

// The kinds' names in `kind`. See domicile_prompt_event.idl.
String NameOf(Kind kind) {
  switch (kind) {
    case Kind::kFileView:
      return "file-view";
    case Kind::kFileEdit:
      return "file-edit";
    case Kind::kFileRestricted:
      return "file-restricted";
    case Kind::kFileDangerous:
      return "file-dangerous";
    case Kind::kClientCertificate:
      return "client-certificate";
    case Kind::kBluetoothPin:
      return "bluetooth-pin";
    case Kind::kBluetoothConfirm:
      return "bluetooth-confirm";
    case Kind::kExtensionPermissions:
      return "extension-permissions";
    case Kind::kExtensionInstall:
      return "extension-install";
    case Kind::kExtensionReEnable:
      return "extension-re-enable";
    case Kind::kResendForm:
      return "resend-form";
    case Kind::kUnresponsive:
      return "unresponsive";
  }
  NOTREACHED();
}

}  // namespace

// Bubbles like the element's other events. Cancelable because
// `preventDefault()` claims the request (see the header).
DomicilePromptEvent::DomicilePromptEvent(
    const AtomicString& type,
    const domicile::mojom::blink::WebViewPrompt& prompt,
    Answer answer,
    HTMLWebViewElement& owner)
    : Event(type, Bubbles::kYes, Cancelable::kYes),
      kind_(NameOf(prompt.kind)),
      origin_(prompt.origin.IsValid()
                  ? SecurityOrigin::Create(prompt.origin)->ToString()
                  : g_empty_string),
      subject_(prompt.subject),
      details_(prompt.details),
      pin_(prompt.pin),
      answer_(std::move(answer)),
      owner_(&owner) {}

DomicilePromptEvent::~DomicilePromptEvent() = default;

void DomicilePromptEvent::accept(int32_t choice,
                                 const String& text,
                                 ExceptionState& exception_state) {
  if (!answer_) {
    exception_state.ThrowDOMException(DOMExceptionCode::kInvalidStateError,
                                      kAnswered);
    return;
  }
  Run(true, choice, text);
}

void DomicilePromptEvent::dismiss(ExceptionState& exception_state) {
  if (!answer_) {
    exception_state.ThrowDOMException(DOMExceptionCode::kInvalidStateError,
                                      kAnswered);
    return;
  }
  Run(false, 0, g_empty_string);
}

void DomicilePromptEvent::DismissIfUnanswered() {
  if (answer_) {
    Run(false, 0, g_empty_string);
  }
}

void DomicilePromptEvent::Run(bool accepted,
                              int32_t choice,
                              const String& text) {
  std::move(answer_).Run(accepted, choice, text);
  owner_->PromptAnswered(*this);
  owner_ = nullptr;
}

const AtomicString& DomicilePromptEvent::InterfaceName() const {
  return event_interface_names::kDomicilePromptEvent;
}

void DomicilePromptEvent::Trace(Visitor* visitor) const {
  visitor->Trace(owner_);
  Event::Trace(visitor);
}

}  // namespace blink
