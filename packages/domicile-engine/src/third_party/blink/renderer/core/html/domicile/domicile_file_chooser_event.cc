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

// Must match the modes in packages/chrome-sdk/src/webview-element.ts.
constexpr char kOpen[] = "open";
constexpr char kOpenMultiple[] = "open-multiple";
constexpr char kOpenFolder[] = "open-folder";
constexpr char kSave[] = "save";

// The browser kills the renderer for a path containing `..` (see ResolvedPath
// in components/domicile/browser/file_choice.h). Checking here first turns that
// into a TypeError the shell can handle.
bool Climbs(const String& path) {
  return path.Split('/').Contains(String(".."));
}

constexpr char kClimbs[] = "A path must not climb with `..`.";

}  // namespace

// Bubbles like the element's other events. Cancelable because
// `preventDefault()` claims the chooser (see the header).
DomicileFileChooserEvent::DomicileFileChooserEvent(
    const AtomicString& type,
    domicile::mojom::blink::WebViewFileChooserMode mode,
    const Vector<String>& accept,
    const String& suggested_name,
    const String& home,
    Answer answer,
    HTMLWebViewElement& owner)
    : Event(type, Bubbles::kYes, Cancelable::kYes),
      mode_(mode),
      accept_(accept),
      suggested_name_(suggested_name),
      home_(home),
      answer_(std::move(answer)),
      owner_(&owner) {}

DomicileFileChooserEvent::~DomicileFileChooserEvent() = default;

// No default case, so a new mojom mode fails the build.
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
    if (Climbs(path)) {
      exception_state.ThrowTypeError(kClimbs);
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
