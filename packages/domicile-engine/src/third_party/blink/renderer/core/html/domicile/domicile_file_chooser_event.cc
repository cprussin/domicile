// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/html/domicile/domicile_file_chooser_event.h"

#include <optional>
#include <utility>

#include "third_party/blink/renderer/core/event_interface_names.h"
#include "third_party/blink/renderer/core/html/domicile/html_web_view_element.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"

namespace blink {

namespace {

// The four `mode`s, spelled the way packages/chrome-sdk/src/webview-element.ts
// spells them.
constexpr char kOpen[] = "open";
constexpr char kOpenMultiple[] = "open-multiple";
constexpr char kOpenFolder[] = "open-folder";
constexpr char kSave[] = "save";

// A path the browser can put under the home: not empty, not absolute, and not
// climbing out. The browser refuses the rest as a bad message, so they are
// refused here first, as the TypeError a shell can read.
bool IsHomeRelative(const String& path) {
  if (path.empty() || path.starts_with('/')) {
    return false;
  }
  return !path.Split('/').Contains(String(".."));
}

}  // namespace

// BUBBLES, so a chrome hears it on the window it drew, like every other event
// the element dispatches. CANCELABLE, because `preventDefault()` is how a
// shell says it is answering -- see the header.
DomicileFileChooserEvent::DomicileFileChooserEvent(
    const AtomicString& type,
    domicile::mojom::blink::WebViewFileChooserMode mode,
    const Vector<String>& accept,
    const String& suggested_name,
    Answer answer,
    HTMLWebViewElement& owner)
    : Event(type, Bubbles::kYes, Cancelable::kYes),
      mode_(mode),
      accept_(accept),
      suggested_name_(suggested_name),
      answer_(std::move(answer)),
      owner_(&owner) {}

DomicileFileChooserEvent::~DomicileFileChooserEvent() = default;

// No default arm, so a mode added to the mojom stops this build rather than
// reaching a shell as a word it has never heard.
String DomicileFileChooserEvent::mode() const {
  switch (mode_) {
    case domicile::mojom::blink::WebViewFileChooserMode::kOpen:
      return kOpen;
    case domicile::mojom::blink::WebViewFileChooserMode::kOpenMultiple:
      return kOpenMultiple;
    case domicile::mojom::blink::WebViewFileChooserMode::kOpenFolder:
      return kOpenFolder;
    case domicile::mojom::blink::WebViewFileChooserMode::kSave:
      return kSave;
  }
}

void DomicileFileChooserEvent::choose(const Vector<String>& paths,
                                      ExceptionState& exception_state) {
  if (!answer_) {
    exception_state.ThrowDOMException(
        DOMExceptionCode::kInvalidStateError,
        "This file chooser has already been answered.");
    return;
  }
  const bool takes_many =
      mode_ == domicile::mojom::blink::WebViewFileChooserMode::kOpenMultiple;
  if (takes_many ? paths.empty() : paths.size() != 1) {
    exception_state.ThrowTypeError(
        takes_many ? "An open-multiple file chooser takes at least one path."
                   : "This file chooser takes exactly one path.");
    return;
  }
  for (const String& path : paths) {
    if (!IsHomeRelative(path)) {
      exception_state.ThrowTypeError(
          "A path must be relative to the home directory, and inside it.");
      return;
    }
  }
  Reply(paths);
}

void DomicileFileChooserEvent::cancel(ExceptionState& exception_state) {
  if (!answer_) {
    exception_state.ThrowDOMException(
        DOMExceptionCode::kInvalidStateError,
        "This file chooser has already been answered.");
    return;
  }
  Reply(std::nullopt);
}

void DomicileFileChooserEvent::CancelIfUnanswered() {
  if (answer_) {
    Reply(std::nullopt);
  }
}

void DomicileFileChooserEvent::Reply(
    const std::optional<Vector<String>>& paths) {
  std::move(answer_).Run(paths);
  owner_->FileChooserAnswered(*this);
  owner_ = nullptr;
}

const AtomicString& DomicileFileChooserEvent::InterfaceName() const {
  return event_interface_names::kDomicileFileChooserEvent;
}

void DomicileFileChooserEvent::Trace(Visitor* visitor) const {
  visitor->Trace(owner_);
  Event::Trace(visitor);
}

}  // namespace blink
