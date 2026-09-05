// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/brokered_frame_sink.h"

#include <utility>

#include "base/time/time.h"
#include "components/viz/common/surfaces/surface_info.h"
#include "components/viz/host/host_frame_sink_manager.h"

namespace domicile {

BrokeredFrameSink::BrokeredFrameSink(
    viz::HostFrameSinkManager* host_frame_sink_manager,
    const viz::FrameSinkId& frame_sink_id,
    mojo::PendingRemote<mojom::SurfaceObserver> observer,
    mojo::ReceiverId owner)
    : host_frame_sink_manager_(host_frame_sink_manager),
      frame_sink_id_(frame_sink_id),
      observer_(std::move(observer)),
      owner_(owner) {
  host_frame_sink_manager_->RegisterFrameSinkId(
      frame_sink_id_, this, viz::ReportFirstSurfaceActivation::kNo);
  host_frame_sink_manager_->SetFrameSinkDebugLabel(frame_sink_id_,
                                                   "BrokeredFrameSink");
}

BrokeredFrameSink::~BrokeredFrameSink() {
  if (parent_frame_sink_id_.is_valid()) {
    host_frame_sink_manager_->UnregisterFrameSinkHierarchy(
        parent_frame_sink_id_, frame_sink_id_);
  }
  host_frame_sink_manager_->InvalidateFrameSinkId(frame_sink_id_, this, {});
}

void BrokeredFrameSink::CreateCompositorFrameSink(
    mojo::PendingRemote<viz::mojom::CompositorFrameSinkClient> client,
    mojo::PendingReceiver<viz::mojom::CompositorFrameSink> receiver) {
  host_frame_sink_manager_->CreateCompositorFrameSink(
      frame_sink_id_, std::move(receiver), std::move(client));
}

void BrokeredFrameSink::Embed(const viz::FrameSinkId& parent_frame_sink_id,
                              const viz::LocalSurfaceId& local_surface_id,
                              const gfx::Size& size) {
  // A page that navigates or reloads embeds again under a different frame
  // sink, so the old edge has to go before the new one is added.
  if (parent_frame_sink_id_.is_valid()) {
    host_frame_sink_manager_->UnregisterFrameSinkHierarchy(
        parent_frame_sink_id_, frame_sink_id_);
  }
  parent_frame_sink_id_ = parent_frame_sink_id;
  host_frame_sink_manager_->RegisterFrameSinkHierarchy(parent_frame_sink_id_,
                                                       frame_sink_id_);

  if (observer_) {
    observer_->OnSurfaceEmbedded(local_surface_id, size);
  }
}

// The producer's LocalSurfaceIds come from the embedder, which allocates them,
// so the browser has nothing to learn from activation. Registration asks for
// ReportFirstSurfaceActivation::kNo and these are never called.
void BrokeredFrameSink::OnFirstSurfaceActivation(
    const viz::SurfaceInfo& surface_info) {}

void BrokeredFrameSink::OnFrameTokenChanged(uint32_t frame_token,
                                            base::TimeTicks activation_time) {}

}  // namespace domicile
