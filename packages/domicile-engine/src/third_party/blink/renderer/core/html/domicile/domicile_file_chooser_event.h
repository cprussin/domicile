// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_FILE_CHOOSER_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_FILE_CHOOSER_EVENT_H_

#include "components/domicile/mojom/web_view_guest.mojom-blink.h"
#include "third_party/blink/renderer/bindings/core/v8/idl_types.h"
#include "third_party/blink/renderer/bindings/core/v8/script_promise.h"
#include "third_party/blink/renderer/core/core_export.h"
#include "third_party/blink/renderer/core/dom/events/event.h"
#include "third_party/blink/renderer/platform/heap/member.h"
#include "third_party/blink/renderer/platform/wtf/text/atomic_string.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"
#include "third_party/blink/renderer/platform/wtf/vector.h"

namespace blink {

class ExceptionState;
class HTMLWebViewElement;
class ScriptState;

// Asks the shell to pick a file for the page inside a <webview>.
//
// - Carries the browser's reply callback. The page's file input or download
//   waits until `choose()` or `cancel()` runs it. The browser expects one
//   answer, so a second throws InvalidStateError.
// - A shell claims it with `preventDefault()`. The element cancels an
//   unclaimed one after dispatch (HTMLWebViewElement::FileChooserRequested),
//   so a shell that does not listen refuses uploads instead of hanging the
//   page.
// - The element holds it until answered. Garbage collection would otherwise
//   drop the callback unrun.
class CORE_EXPORT DomicileFileChooserEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  using Answer = domicile::mojom::blink::WebViewGuestClient::
      FileChooserRequestedCallback;

  DomicileFileChooserEvent(const AtomicString& type,
                           domicile::mojom::blink::WebViewFileChooserMode mode,
                           const Vector<String>& accept,
                           const String& suggested_name,
                           const String& home,
                           Answer answer,
                           HTMLWebViewElement& owner);
  ~DomicileFileChooserEvent() override;

  String mode() const;
  const Vector<String>& accept() const { return accept_; }
  const String& suggestedName() const { return suggested_name_; }
  const String& home() const { return home_; }

  void choose(const Vector<String>& paths, ExceptionState&);
  ScriptPromise<IDLSequence<IDLString>> list(ScriptState*,
                                             const String& path,
                                             ExceptionState&);
  void cancel(ExceptionState&);

  // Called by the element for an event no shell claimed.
  void CancelIfUnanswered();

  const AtomicString& InterfaceName() const override;

  void Trace(Visitor*) const override;

 private:
  void Reply(const std::optional<Vector<String>>& paths);

  domicile::mojom::blink::WebViewFileChooserMode mode_;
  Vector<String> accept_;
  String suggested_name_;
  String home_;
  // Null once answered.
  Answer answer_;
  // Notified on answer so it releases this event.
  Member<HTMLWebViewElement> owner_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_FILE_CHOOSER_EVENT_H_
