// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/core/html/domicile/domicile_device_request_event.h"

#include <utility>

#include "third_party/blink/renderer/bindings/core/v8/v8_domicile_device.h"
#include "third_party/blink/renderer/core/event_interface_names.h"
#include "third_party/blink/renderer/core/html/domicile/html_web_view_element.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"

namespace blink {

// Bubbles like the element's other events. Cancelable because
// `preventDefault()` claims the request (see the header).
DomicileDeviceRequestEvent::DomicileDeviceRequestEvent(
    const AtomicString& type,
    const String& title,
    bool multiple,
    Answer answer,
    HTMLWebViewElement& owner)
    : Event(type, Bubbles::kYes, Cancelable::kYes),
      title_(title),
      multiple_(multiple),
      answer_(std::move(answer)),
      owner_(&owner) {}

DomicileDeviceRequestEvent::~DomicileDeviceRequestEvent() = default;

HeapVector<Member<DomicileDevice>> DomicileDeviceRequestEvent::devices() const {
  HeapVector<Member<DomicileDevice>> devices;
  for (const auto& [id, name] : devices_) {
    auto* device = DomicileDevice::Create();
    device->setId(id);
    device->setName(name);
    devices.push_back(device);
  }
  return devices;
}

void DomicileDeviceRequestEvent::choose(const Vector<int32_t>& ids,
                                        ExceptionState& exception_state) {
  if (!answer_) {
    exception_state.ThrowDOMException(
        DOMExceptionCode::kInvalidStateError,
        "This device request has already been answered or withdrawn.");
    return;
  }
  if (ids.empty() || (!multiple_ && ids.size() > 1)) {
    exception_state.ThrowTypeError(
        multiple_ ? "This device request takes at least one device."
                  : "This device request takes exactly one device.");
    return;
  }
  HashSet<int32_t> seen;
  for (const int32_t id : ids) {
    // Ids start at 1. Checked first, because 0 and -1 are a HashSet's empty
    // and deleted markers and may not be looked up.
    if (id < 1 || !offered_.Contains(id)) {
      exception_state.ThrowTypeError("No device with that id was offered.");
      return;
    }
    if (!seen.insert(id).is_new_entry) {
      exception_state.ThrowTypeError("A device was chosen twice.");
      return;
    }
  }
  Run(ids);
}

void DomicileDeviceRequestEvent::cancel(ExceptionState& exception_state) {
  if (!answer_) {
    exception_state.ThrowDOMException(
        DOMExceptionCode::kInvalidStateError,
        "This device request has already been answered or withdrawn.");
    return;
  }
  Run(std::nullopt);
}

void DomicileDeviceRequestEvent::Offer(
    const Vector<domicile::mojom::blink::WebViewDevicePtr>& devices) {
  listed_ = true;
  devices_.clear();
  for (const auto& device : devices) {
    devices_.push_back(std::make_pair(device->id, device->name));
    offered_.insert(device->id);
  }
}

void DomicileDeviceRequestEvent::CancelIfUnanswered() {
  if (answer_) {
    Run(std::nullopt);
  }
}

void DomicileDeviceRequestEvent::Run(
    const std::optional<Vector<int32_t>>& chosen) {
  std::move(answer_).Run(chosen);
  owner_->DeviceRequestAnswered(*this);
  owner_ = nullptr;
}

const AtomicString& DomicileDeviceRequestEvent::InterfaceName() const {
  return event_interface_names::kDomicileDeviceRequestEvent;
}

void DomicileDeviceRequestEvent::Trace(Visitor* visitor) const {
  visitor->Trace(owner_);
  Event::Trace(visitor);
}

}  // namespace blink
