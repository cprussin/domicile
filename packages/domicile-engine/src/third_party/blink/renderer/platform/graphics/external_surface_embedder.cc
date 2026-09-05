// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/platform/graphics/external_surface_embedder.h"

#include <utility>

#include "third_party/blink/public/common/thread_safe_browser_interface_broker_proxy.h"
#include "third_party/blink/public/platform/platform.h"
#include "base/functional/bind.h"

namespace blink {

ExternalSurfaceEmbedder::ExternalSurfaceEmbedder() = default;

ExternalSurfaceEmbedder::~ExternalSurfaceEmbedder() = default;

void ExternalSurfaceEmbedder::Embed(
    const viz::FrameSinkId& parent_frame_sink_id,
    const gfx::Size& size,
    EmbeddedCallback callback) {
  if (!provider_) {
    Platform::Current()->GetBrowserInterfaceBroker()->GetInterface(
        provider_.BindNewPipeAndPassReceiver());
  }

  // Allocated before the round trip rather than after it: this half of the
  // SurfaceId is ours, and the browser needs it in order to hand it to the
  // producer, which cannot invent one.
  local_surface_id_allocator_.GenerateId();
  const viz::LocalSurfaceId local_surface_id =
      local_surface_id_allocator_.GetCurrentLocalSurfaceId();

  provider_->Embed(
      parent_frame_sink_id, local_surface_id, size,
      base::BindOnce(&ExternalSurfaceEmbedder::OnEmbedded,
                     base::Unretained(this), std::move(callback),
                     local_surface_id));
}

void ExternalSurfaceEmbedder::OnEmbedded(
    EmbeddedCallback callback,
    const viz::LocalSurfaceId& local_surface_id,
    const std::optional<viz::FrameSinkId>& frame_sink_id) {
  if (!frame_sink_id) {
    std::move(callback).Run(std::nullopt);
    return;
  }
  std::move(callback).Run(viz::SurfaceId(*frame_sink_id, local_surface_id));
}

}  // namespace blink
