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
    mojo::PendingReceiver<mojom::ExternalSurfaceProvider> receiver) {
  receivers_.Add(this, std::move(receiver));
}

// The page only grants access here: it names its parent frame sink and
// allocates the LocalSurfaceId.
//
// TODO: check that the renderer owns the parent frame sink, as
// content::EmbeddedFrameSinkProviderImpl does with renderer_client_id_. This
// needs the renderer's child process id, so the binding must go through
// RenderProcessHostImpl.
void ExternalSurfaceProvider::Embed(
    const std::string& app_id,
    const viz::FrameSinkId& parent_frame_sink_id,
    const viz::LocalSurfaceId& local_surface_id,
    const gfx::Size& size,
    double scale,
    EmbedCallback callback) {
  broker_->Embed(app_id, parent_frame_sink_id, local_surface_id, size, scale,
                 std::move(callback));
}

}  // namespace domicile
