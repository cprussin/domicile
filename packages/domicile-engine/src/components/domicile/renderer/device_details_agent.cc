// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/renderer/device_details_agent.h"

#include <utility>

#include "base/functional/bind.h"
#include "content/public/renderer/render_frame.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"
#include "third_party/blink/public/web/web_local_frame.h"

namespace domicile {

// static
void DeviceDetailsAgent::Attach(content::RenderFrame* frame) {
  new DeviceDetailsAgent(frame);
}

DeviceDetailsAgent::DeviceDetailsAgent(content::RenderFrame* frame)
    : content::RenderFrameObserver(frame) {
  frame->GetAssociatedInterfaceRegistry()
      ->AddInterface<mojom::DeviceDetails>(base::BindRepeating(
          &DeviceDetailsAgent::Bind, weak_factory_.GetWeakPtr()));
}

DeviceDetailsAgent::~DeviceDetailsAgent() = default;

void DeviceDetailsAgent::Bind(
    mojo::PendingAssociatedReceiver<mojom::DeviceDetails> receiver) {
  // The browser asks again for each navigation.
  receiver_.reset();
  receiver_.Bind(std::move(receiver));
}

void DeviceDetailsAgent::Hide(uint64_t seed) {
  next_ = seed;
}

void DeviceDetailsAgent::ReadyToCommitNavigation(
    blink::WebDocumentLoader* document_loader) {
  // A new document: one the browser sent nothing for keeps the truth.
  committing_ = std::exchange(next_, std::nullopt);
}

void DeviceDetailsAgent::DidCommitProvisionalLoad(
    ui::PageTransition transition) {
  // The new document's window exists, and nothing of the page has run.
  render_frame()->GetWebFrame()->SetDomicileDeviceDetailsSeed(
      std::exchange(committing_, std::nullopt));
}

void DeviceDetailsAgent::OnDestruct() {
  delete this;
}

}  // namespace domicile
