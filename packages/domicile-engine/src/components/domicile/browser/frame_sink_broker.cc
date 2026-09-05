// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/frame_sink_broker.h"

#include <utility>

#include "base/containers/flat_map.h"
#include "base/functional/bind.h"
#include "components/domicile/browser/brokered_frame_sink.h"
#include "components/viz/host/host_frame_sink_manager.h"

namespace domicile {

FrameSinkBroker::PendingEmbed::PendingEmbed(
    const viz::FrameSinkId& parent_frame_sink_id,
    const viz::LocalSurfaceId& local_surface_id,
    const gfx::Size& size,
    EmbedCallback callback)
    : parent_frame_sink_id(parent_frame_sink_id),
      local_surface_id(local_surface_id),
      size(size),
      callback(std::move(callback)) {}

FrameSinkBroker::PendingEmbed::PendingEmbed(PendingEmbed&&) = default;

FrameSinkBroker::PendingEmbed& FrameSinkBroker::PendingEmbed::operator=(
    PendingEmbed&&) = default;

FrameSinkBroker::PendingEmbed::~PendingEmbed() = default;

FrameSinkBroker::FrameSinkBroker(
    viz::HostFrameSinkManager* host_frame_sink_manager,
    FrameSinkIdAllocator allocate_frame_sink_id)
    : host_frame_sink_manager_(host_frame_sink_manager),
      allocate_frame_sink_id_(std::move(allocate_frame_sink_id)) {
  CHECK(host_frame_sink_manager);
  CHECK(allocate_frame_sink_id_);
  receivers_.set_disconnect_handler(base::BindRepeating(
      &FrameSinkBroker::OnProducerDisconnected, base::Unretained(this)));
}

FrameSinkBroker::~FrameSinkBroker() = default;

void FrameSinkBroker::Bind(
    mojo::PendingReceiver<mojom::FrameSinkBroker> receiver) {
  receivers_.Add(this, std::move(receiver));
}

void FrameSinkBroker::Embed(const viz::FrameSinkId& parent_frame_sink_id,
                            const viz::LocalSurfaceId& local_surface_id,
                            const gfx::Size& size,
                            EmbedCallback callback) {
  BrokeredFrameSink* frame_sink = MostRecentlyBrokeredSink();
  if (!frame_sink) {
    pending_embeds_.emplace_back(parent_frame_sink_id, local_surface_id, size,
                                 std::move(callback));
    return;
  }

  frame_sink->Embed(parent_frame_sink_id, local_surface_id, size);
  std::move(callback).Run(frame_sink->frame_sink_id());
}

void FrameSinkBroker::CreateFrameSink(
    mojo::PendingRemote<viz::mojom::CompositorFrameSinkClient> client,
    mojo::PendingReceiver<viz::mojom::CompositorFrameSink> receiver,
    mojo::PendingRemote<mojom::SurfaceObserver> observer,
    CreateFrameSinkCallback callback) {
  const viz::FrameSinkId frame_sink_id = allocate_frame_sink_id_.Run();

  auto frame_sink = std::make_unique<BrokeredFrameSink>(
      host_frame_sink_manager_, frame_sink_id, std::move(observer),
      receivers_.current_receiver());
  frame_sink->CreateCompositorFrameSink(std::move(client), std::move(receiver));
  BrokeredFrameSink* raw_frame_sink = frame_sink.get();
  frame_sink_map_[frame_sink_id] = std::move(frame_sink);
  most_recently_brokered_ = frame_sink_id;

  std::move(callback).Run(frame_sink_id);

  // Pages that embedded before there was anything to embed have been waiting
  // for exactly this.
  std::vector<PendingEmbed> pending = std::move(pending_embeds_);
  pending_embeds_.clear();
  for (PendingEmbed& embed : pending) {
    raw_frame_sink->Embed(embed.parent_frame_sink_id, embed.local_surface_id,
                          embed.size);
    std::move(embed.callback).Run(frame_sink_id);
  }
}

void FrameSinkBroker::DestroyFrameSink(const viz::FrameSinkId& frame_sink_id) {
  auto iter = frame_sink_map_.find(frame_sink_id);
  if (iter == frame_sink_map_.end()) {
    receivers_.ReportBadMessage("No brokered frame sink for FrameSinkId");
    return;
  }
  if (iter->second->owner() != receivers_.current_receiver()) {
    receivers_.ReportBadMessage("FrameSinkId belongs to another producer");
    return;
  }
  frame_sink_map_.erase(iter);
}

BrokeredFrameSink* FrameSinkBroker::MostRecentlyBrokeredSink() {
  auto iter = frame_sink_map_.find(most_recently_brokered_);
  return iter == frame_sink_map_.end() ? nullptr : iter->second.get();
}

void FrameSinkBroker::OnProducerDisconnected() {
  const mojo::ReceiverId owner = receivers_.current_receiver();
  base::EraseIf(frame_sink_map_, [owner](const auto& entry) {
    return entry.second->owner() == owner;
  });
}

}  // namespace domicile
