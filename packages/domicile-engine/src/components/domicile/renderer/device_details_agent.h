// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_RENDERER_DEVICE_DETAILS_AGENT_H_
#define COMPONENTS_DOMICILE_RENDERER_DEVICE_DETAILS_AGENT_H_

#include <cstdint>
#include <optional>

#include "base/memory/weak_ptr.h"
#include "components/domicile/mojom/device_details.mojom.h"
#include "content/public/renderer/render_frame_observer.h"
#include "mojo/public/cpp/bindings/associated_receiver.h"

namespace domicile {

// A frame's device details, in the renderer: hands Blink the seed the
// browser sends before each navigation commits (DeviceDetailsHiding, in
// domicile_device_details.cc), for the new document's window, which farbles
// what the page reads of the device with it. A document it sent none for
// keeps the truth, unless it is in a frame whose parent hides them. See
// docs/architecture/AD-BLOCKING.md.
//
// Every frame has one; only those the browser sends a Hide to do anything.
class DeviceDetailsAgent final : public content::RenderFrameObserver,
                                 public mojom::DeviceDetails {
 public:
  // Gives `frame` one. The frame owns it.
  static void Attach(content::RenderFrame* frame);

  DeviceDetailsAgent(const DeviceDetailsAgent&) = delete;
  DeviceDetailsAgent& operator=(const DeviceDetailsAgent&) = delete;
  ~DeviceDetailsAgent() override;

  // content::RenderFrameObserver:
  void ReadyToCommitNavigation(
      blink::WebDocumentLoader* document_loader) override;
  void DidCommitProvisionalLoad(ui::PageTransition transition) override;
  void OnDestruct() override;

  // mojom::DeviceDetails:
  void Hide(uint64_t seed) override;

 private:
  explicit DeviceDetailsAgent(content::RenderFrame* frame);

  void Bind(mojo::PendingAssociatedReceiver<mojom::DeviceDetails> receiver);

  mojo::AssociatedReceiver<mojom::DeviceDetails> receiver_{this};
  // What a Hide sent for the document about to commit, then the committing
  // one's.
  std::optional<uint64_t> next_;
  std::optional<uint64_t> committing_;
  base::WeakPtrFactory<DeviceDetailsAgent> weak_factory_{this};
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_RENDERER_DEVICE_DETAILS_AGENT_H_
