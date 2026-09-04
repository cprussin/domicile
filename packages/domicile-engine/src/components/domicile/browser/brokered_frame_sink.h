// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_BROWSER_BROKERED_FRAME_SINK_H_
#define COMPONENTS_DOMICILE_BROWSER_BROKERED_FRAME_SINK_H_

#include "base/memory/raw_ptr.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "components/viz/host/host_frame_sink_client.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/receiver_set.h"
#include "services/viz/public/mojom/compositing/compositor_frame_sink.mojom.h"

namespace viz {
class HostFrameSinkManager;
}

namespace domicile {

// A brokered frame sink: the browser's registration of one FrameSinkId with
// viz, held for as long as the producer wants to submit to it.
//
// This is the non-renderer counterpart of content::EmbeddedFrameSinkImpl, minus
// the hierarchy: an embedded frame sink knows its parent at construction
// because embedder and embedded live in the same renderer, and a brokered one
// does not.
class BrokeredFrameSink : public viz::HostFrameSinkClient {
 public:
  BrokeredFrameSink(viz::HostFrameSinkManager* host_frame_sink_manager,
                    const viz::FrameSinkId& frame_sink_id,
                    mojo::ReceiverId owner);

  BrokeredFrameSink(const BrokeredFrameSink&) = delete;
  BrokeredFrameSink& operator=(const BrokeredFrameSink&) = delete;

  ~BrokeredFrameSink() override;

  const viz::FrameSinkId& frame_sink_id() const { return frame_sink_id_; }

  // The FrameSinkBroker connection that asked for this sink. A producer only
  // gets to destroy its own, and loses all of them when it disconnects.
  mojo::ReceiverId owner() const { return owner_; }

  // Creates the CompositorFrameSink connection to viz for this id.
  void CreateCompositorFrameSink(
      mojo::PendingRemote<viz::mojom::CompositorFrameSinkClient> client,
      mojo::PendingReceiver<viz::mojom::CompositorFrameSink> receiver);

  // viz::HostFrameSinkClient implementation.
  void OnFirstSurfaceActivation(const viz::SurfaceInfo& surface_info) override;
  void OnFrameTokenChanged(uint32_t frame_token,
                           base::TimeTicks activation_time) override;

 private:
  const raw_ptr<viz::HostFrameSinkManager> host_frame_sink_manager_;
  const viz::FrameSinkId frame_sink_id_;
  const mojo::ReceiverId owner_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_BROKERED_FRAME_SINK_H_
