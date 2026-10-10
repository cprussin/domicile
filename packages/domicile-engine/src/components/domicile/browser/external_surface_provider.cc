// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/external_surface_provider.h"

#include <utility>

#include "components/domicile/browser/frame_sink_broker.h"

namespace domicile {

ExternalSurfaceProvider::ExternalSurfaceProvider(FrameSinkBroker* broker)
    : broker_(broker) {
  CHECK(broker);
}

ExternalSurfaceProvider::~ExternalSurfaceProvider() = default;

void ExternalSurfaceProvider::Bind(
    mojo::PendingReceiver<mojom::ExternalSurfaceProvider> receiver,
    uint32_t renderer_client_id) {
  receivers_.Add(this, std::move(receiver), renderer_client_id);
}

// The page only grants access here: it names its parent frame sink and
// allocates the LocalSurfaceId. The parent must be in the calling renderer's
// namespace, as content::EmbeddedFrameSinkProviderImpl requires.
void ExternalSurfaceProvider::Embed(
    const std::string& app_id,
    const viz::FrameSinkId& parent_frame_sink_id,
    const viz::LocalSurfaceId& local_surface_id,
    const gfx::Size& size,
    double scale,
    EmbedCallback callback) {
  if (parent_frame_sink_id.client_id() != receivers_.current_context()) {
    receivers_.ReportBadMessage("parent frame sink is not the renderer's");
  } else {
    broker_->Embed(app_id, parent_frame_sink_id, local_surface_id, size, scale,
                   std::move(callback));
  }
}

}  // namespace domicile
