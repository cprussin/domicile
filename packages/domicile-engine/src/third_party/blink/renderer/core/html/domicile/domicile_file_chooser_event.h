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

// The page inside a <webview> needs a file picked, and waits for the shell to
// say which.
//
// A QUESTION RATHER THAN A NOTICE, which is what sets it apart from every
// other event the element dispatches: it carries the browser's reply callback,
// and the page's `<input type="file">` -- or a download -- is held until
// `choose()` or `cancel()` runs it. Exactly once: the browser's listener
// expects one answer, so a second is an InvalidStateError here rather than a
// message the browser has to decide what to do with.
//
// CANCELABLE, AND `preventDefault()` IS HOW A SHELL TAKES IT. One nobody takes
// is canceled by the element as soon as the dispatch returns -- see
// HTMLWebViewElement::FileChooserRequested -- so a shell that does not listen
// is a desktop where uploads are refused, not one where the page hangs.
//
// HELD BY THE ELEMENT UNTIL ANSWERED, so that a shell that takes one and puts
// it aside to draw a picker is not racing the garbage collector: an event
// collected unanswered would drop the browser's callback without running it.
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

  // Cancel it if nobody has answered, which is what the element does for an
  // event no shell took.
  void CancelIfUnanswered();

  const AtomicString& InterfaceName() const override;

  void Trace(Visitor*) const override;

 private:
  void Reply(const std::optional<Vector<String>>& paths);

  domicile::mojom::blink::WebViewFileChooserMode mode_;
  Vector<String> accept_;
  String suggested_name_;
  String home_;
  // Null once run: the answer has been given.
  Answer answer_;
  // Told when the answer is given, so it stops holding this.
  Member<HTMLWebViewElement> owner_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_HTML_DOMICILE_DOMICILE_FILE_CHOOSER_EVENT_H_
