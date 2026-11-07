// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/html/domicile/domicile_picker_event.h"

#include <utility>

#include "base/notreached.h"
#include "third_party/blink/renderer/core/event_interface_names.h"
#include "third_party/blink/renderer/core/html/domicile/html_web_view_element.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"

namespace blink {

namespace {

constexpr char kAnswered[] =
    "This picker has already been answered or withdrawn.";

using Kind = domicile::mojom::blink::WebViewPickerKind;

// The kinds' names in `kind`. See domicile_picker_event.idl.
String NameOf(Kind kind) {
  switch (kind) {
    case Kind::kColor:
      return "color";
    case Kind::kDate:
      return "date";
    case Kind::kTime:
      return "time";
    case Kind::kDateTimeLocal:
      return "datetime-local";
    case Kind::kMonth:
      return "month";
    case Kind::kWeek:
      return "week";
    case Kind::kList:
      return "list";
  }
  NOTREACHED();
}

}  // namespace

// Bubbles like the element's other events. Cancelable because
// `preventDefault()` claims the picker.
DomicilePickerEvent::DomicilePickerEvent(
    const AtomicString& type,
    const domicile::mojom::blink::WebViewPicker& picker,
    Answer answer,
    HTMLWebViewElement& owner)
    : Event(type, Bubbles::kYes, Cancelable::kYes),
      kind_(NameOf(picker.kind)),
      value_(picker.value),
      min_(picker.min),
      max_(picker.max),
      step_(picker.step),
      anchor_(picker.anchor),
      answer_(std::move(answer)),
      owner_(&owner) {
  for (const auto& option : picker.options) {
    options_.push_back(option->value);
    labels_.push_back(option->label);
  }
}

DomicilePickerEvent::~DomicilePickerEvent() = default;

void DomicilePickerEvent::choose(const String& value,
                                 ExceptionState& exception_state) {
  if (!answer_) {
    exception_state.ThrowDOMException(DOMExceptionCode::kInvalidStateError,
                                      kAnswered);
    return;
  }
  Run(true, value);
}

void DomicilePickerEvent::cancel(ExceptionState& exception_state) {
  if (!answer_) {
    exception_state.ThrowDOMException(DOMExceptionCode::kInvalidStateError,
                                      kAnswered);
    return;
  }
  Run(false, g_empty_string);
}

void DomicilePickerEvent::CancelIfUnanswered() {
  if (answer_) {
    Run(false, g_empty_string);
  }
}

void DomicilePickerEvent::Run(bool picked, const String& value) {
  std::move(answer_).Run(picked, value);
  owner_->PickerAnswered(*this);
  owner_ = nullptr;
}

const AtomicString& DomicilePickerEvent::InterfaceName() const {
  return event_interface_names::kDomicilePickerEvent;
}

void DomicilePickerEvent::Trace(Visitor* visitor) const {
  visitor->Trace(owner_);
  Event::Trace(visitor);
}

}  // namespace blink
