// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/platform/graphics/external_surface_embedder.h"

#include <utility>

#include "base/functional/bind.h"
#include "components/viz/common/surfaces/parent_local_surface_id_allocator.h"
#include "third_party/blink/public/common/thread_safe_browser_interface_broker_proxy.h"
#include "third_party/blink/public/platform/platform.h"

namespace blink {
namespace {

// One external surface per renderer, shared by every element that embeds it.
//
// The spike has one producer, so it has one surface, and an element that asks
// to embed is asking for that one. Sharing it is what lets a page put several
// <app> elements side by side against a single producer, which is how the CSS
// measurement compares each property against an ordinary element beside it.
//
// This is the spike's simplification and not the design's. A shell has many
// apps and so many surfaces, and which one an element shows is keyed by which
// app it names — the chrome protocol's job, not this layer's. What does not
// change is who allocates: the embedder, because the embed_token in the id is
// the capability the producer needs in order to submit at all.
viz::ParentLocalSurfaceIdAllocator& SharedAllocator() {
  static viz::ParentLocalSurfaceIdAllocator allocator;
  return allocator;
}

}  // namespace

ExternalSurfaceEmbedder::ExternalSurfaceEmbedder() = default;

ExternalSurfaceEmbedder::~ExternalSurfaceEmbedder() = default;

void ExternalSurfaceEmbedder::Embed(
    const viz::FrameSinkId& parent_frame_sink_id,
    const gfx::Size& size,
    Allocation allocation,
    EmbeddedCallback callback) {
  if (!provider_) {
    Platform::Current()->GetBrowserInterfaceBroker()->GetInterface(
        provider_.BindNewPipeAndPassReceiver());
  }

  // Resolved before the round trip rather than after it: this half of the
  // SurfaceId is ours, and the browser needs it in order to hand it to the
  // producer, which cannot invent one.
  viz::ParentLocalSurfaceIdAllocator& allocator = SharedAllocator();
  if (allocation == Allocation::kReconfigure ||
      !allocator.HasValidLocalSurfaceId()) {
    allocator.GenerateId();
  }
  const viz::LocalSurfaceId local_surface_id =
      allocator.GetCurrentLocalSurfaceId();

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
