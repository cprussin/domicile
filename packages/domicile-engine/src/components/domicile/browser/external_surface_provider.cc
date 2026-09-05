// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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

// Nothing is checked here, and that is the design rather than an omission. The
// page names a parent frame sink and allocates a LocalSurfaceId; both are
// things it gives away rather than things it takes. What is *not* checked, and
// should be before this is anything but a spike, is that the renderer owns the
// parent frame sink it names — the check
// content::EmbeddedFrameSinkProviderImpl makes against its renderer_client_id_.
// Making it needs the calling renderer's child process id, which means binding
// this through RenderProcessHostImpl rather than as a free function.
void ExternalSurfaceProvider::Embed(
    const viz::FrameSinkId& parent_frame_sink_id,
    const viz::LocalSurfaceId& local_surface_id,
    const gfx::Size& size,
    EmbedCallback callback) {
  broker_->Embed(parent_frame_sink_id, local_surface_id, size,
                 std::move(callback));
}

}  // namespace domicile
