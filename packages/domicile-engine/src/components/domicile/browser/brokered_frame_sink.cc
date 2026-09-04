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
    mojo::ReceiverId owner)
    : host_frame_sink_manager_(host_frame_sink_manager),
      frame_sink_id_(frame_sink_id),
      owner_(owner) {
  host_frame_sink_manager_->RegisterFrameSinkId(
      frame_sink_id_, this, viz::ReportFirstSurfaceActivation::kNo);
  host_frame_sink_manager_->SetFrameSinkDebugLabel(frame_sink_id_,
                                                   "BrokeredFrameSink");
}

BrokeredFrameSink::~BrokeredFrameSink() {
  host_frame_sink_manager_->InvalidateFrameSinkId(frame_sink_id_, this, {});
}

void BrokeredFrameSink::CreateCompositorFrameSink(
    mojo::PendingRemote<viz::mojom::CompositorFrameSinkClient> client,
    mojo::PendingReceiver<viz::mojom::CompositorFrameSink> receiver) {
  host_frame_sink_manager_->CreateCompositorFrameSink(
      frame_sink_id_, std::move(receiver), std::move(client));
}

// The producer's LocalSurfaceIds come from the embedder, which allocates them,
// so the browser has nothing to learn from activation. Registration asks for
// ReportFirstSurfaceActivation::kNo and these are never called.
void BrokeredFrameSink::OnFirstSurfaceActivation(
    const viz::SurfaceInfo& surface_info) {}

void BrokeredFrameSink::OnFrameTokenChanged(uint32_t frame_token,
                                            base::TimeTicks activation_time) {}

}  // namespace domicile
