// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_PERMISSION_REQUEST_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_PERMISSION_REQUEST_EVENT_H_

#include <optional>

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

// Asks the shell to answer a permission request from the page inside a
// <webview>.
//
// - Carries the browser's reply callback, as DomicileFileChooserEvent does.
//   The browser expects one answer, so a second throws InvalidStateError.
// - A shell claims it with `preventDefault()`. The element ignores an
//   unclaimed one after dispatch, so a shell that does not listen leaves
//   sites without the permission, and stores nothing.
// - The element holds it until answered or withdrawn. Garbage collection
//   would otherwise drop the callback unrun.
class CORE_EXPORT DomicilePermissionRequestEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  using Answer = domicile::mojom::blink::WebViewGuestClient::
      PermissionRequestedCallback;

  // The name of each permission, shared with the element's site permissions.
  // Must match WEBVIEW_PERMISSIONS in packages/chrome-sdk/src/webview-element.ts.
  static String PermissionName(
      domicile::mojom::blink::WebViewPermission permission);
  // The permission named `name`, or nothing for an unknown name.
  static std::optional<domicile::mojom::blink::WebViewPermission>
  PermissionNamed(const String& name);

  DomicilePermissionRequestEvent(
      const AtomicString& type,
      const String& origin,
      const Vector<domicile::mojom::blink::WebViewPermission>& permissions,
      Answer answer,
      HTMLWebViewElement& owner);
  ~DomicilePermissionRequestEvent() override;

  const String& origin() const { return origin_; }
  const Vector<String>& permissions() const { return permissions_; }

  void allow(ExceptionState&);
  void deny(ExceptionState&);
  void dismiss(ExceptionState&);

  // Called by the element: for an event no shell claimed, and when the browser
  // withdraws the request. Answers that nothing was decided.
  void IgnoreIfUnanswered();

  const AtomicString& InterfaceName() const override;

  void Trace(Visitor*) const override;

 private:
  void Reply(domicile::mojom::blink::WebViewPermissionAnswer answer,
             ExceptionState&);
  void Run(std::optional<domicile::mojom::blink::WebViewPermissionAnswer>);

  String origin_;
  Vector<String> permissions_;
  // Null once answered.
  Answer answer_;
  // Notified on answer so it releases this event.
  Member<HTMLWebViewElement> owner_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_PERMISSION_REQUEST_EVENT_H_
