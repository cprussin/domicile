// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/html/domicile/domicile_permission_request_event.h"

#include <utility>

#include "third_party/blink/renderer/core/event_interface_names.h"
#include "third_party/blink/renderer/core/html/domicile/html_web_view_element.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"

namespace blink {

namespace {

using domicile::mojom::blink::WebViewPermission;
using domicile::mojom::blink::WebViewPermissionAnswer;

constexpr char kCamera[] = "camera";
constexpr char kMicrophone[] = "microphone";
constexpr char kLocation[] = "location";
constexpr char kNotifications[] = "notifications";
constexpr char kClipboard[] = "clipboard";
constexpr char kMidi[] = "midi";

}  // namespace

// static
// No default case, so a new mojom permission fails the build.
String DomicilePermissionRequestEvent::PermissionName(
    WebViewPermission permission) {
  switch (permission) {
    case WebViewPermission::kCamera:
      return kCamera;
    case WebViewPermission::kMicrophone:
      return kMicrophone;
    case WebViewPermission::kLocation:
      return kLocation;
    case WebViewPermission::kNotifications:
      return kNotifications;
    case WebViewPermission::kClipboard:
      return kClipboard;
    case WebViewPermission::kMidi:
      return kMidi;
  }
}

// static
std::optional<WebViewPermission>
DomicilePermissionRequestEvent::PermissionNamed(const String& name) {
  for (const WebViewPermission permission :
       {WebViewPermission::kCamera, WebViewPermission::kMicrophone,
        WebViewPermission::kLocation, WebViewPermission::kNotifications,
        WebViewPermission::kClipboard, WebViewPermission::kMidi}) {
    if (name == PermissionName(permission)) {
      return permission;
    }
  }
  return std::nullopt;
}

// Bubbles like the element's other events. Cancelable because
// `preventDefault()` claims the request (see the header).
DomicilePermissionRequestEvent::DomicilePermissionRequestEvent(
    const AtomicString& type,
    const String& origin,
    const Vector<WebViewPermission>& permissions,
    Answer answer,
    HTMLWebViewElement& owner)
    : Event(type, Bubbles::kYes, Cancelable::kYes),
      origin_(origin),
      answer_(std::move(answer)),
      owner_(&owner) {
  for (const WebViewPermission permission : permissions) {
    permissions_.push_back(PermissionName(permission));
  }
}

DomicilePermissionRequestEvent::~DomicilePermissionRequestEvent() = default;

void DomicilePermissionRequestEvent::allow(ExceptionState& exception_state) {
  Reply(WebViewPermissionAnswer::kAllow, exception_state);
}

void DomicilePermissionRequestEvent::deny(ExceptionState& exception_state) {
  Reply(WebViewPermissionAnswer::kDeny, exception_state);
}

void DomicilePermissionRequestEvent::dismiss(ExceptionState& exception_state) {
  Reply(WebViewPermissionAnswer::kDismiss, exception_state);
}

void DomicilePermissionRequestEvent::IgnoreIfUnanswered() {
  if (answer_) {
    Run(std::nullopt);
  }
}

void DomicilePermissionRequestEvent::Reply(WebViewPermissionAnswer answer,
                                           ExceptionState& exception_state) {
  if (!answer_) {
    exception_state.ThrowDOMException(
        DOMExceptionCode::kInvalidStateError,
        "This permission request has already been answered or withdrawn.");
    return;
  }
  Run(answer);
}

void DomicilePermissionRequestEvent::Run(
    std::optional<WebViewPermissionAnswer> answer) {
  std::move(answer_).Run(answer);
  owner_->PermissionRequestAnswered(*this);
  owner_ = nullptr;
}

const AtomicString& DomicilePermissionRequestEvent::InterfaceName() const {
  return event_interface_names::kDomicilePermissionRequestEvent;
}

void DomicilePermissionRequestEvent::Trace(Visitor* visitor) const {
  visitor->Trace(owner_);
  Event::Trace(visitor);
}

}  // namespace blink
