// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_BROWSER_FRAME_SINK_BROKER_H_
#define COMPONENTS_DOMICILE_BROWSER_FRAME_SINK_BROKER_H_

#include <memory>

#include "base/containers/flat_map.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "components/domicile/mojom/frame_sink_broker.mojom.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/receiver_set.h"

namespace viz {
class HostFrameSinkManager;
}

namespace domicile {

class BrokeredFrameSink;

// Brokers viz frame sinks to a compositing producer that is not a renderer.
//
// content::EmbeddedFrameSinkProviderImpl is the same service for renderers, and
// every entry point it has begins by rejecting a FrameSinkId whose client id is
// not the calling renderer's. That check is namespace ownership, not privilege:
// a renderer may name only ids keyed by its own child process id, because that
// is the namespace the browser handed it. A producer outside the process tree
// owns no namespace at all, so instead of validating an id the caller supplies,
// this allocates one and returns it. `allocate_frame_sink_id` is how the
// embedder passes in its own allocator — the ids must come from the same source
// as every other frame sink the browser owns, or two of them collide.
class FrameSinkBroker : public mojom::FrameSinkBroker {
 public:
  using FrameSinkIdAllocator = base::RepeatingCallback<viz::FrameSinkId()>;

  FrameSinkBroker(viz::HostFrameSinkManager* host_frame_sink_manager,
                  FrameSinkIdAllocator allocate_frame_sink_id);

  FrameSinkBroker(const FrameSinkBroker&) = delete;
  FrameSinkBroker& operator=(const FrameSinkBroker&) = delete;

  ~FrameSinkBroker() override;

  void Bind(mojo::PendingReceiver<mojom::FrameSinkBroker> receiver);

  // mojom::FrameSinkBroker implementation.
  void CreateFrameSink(
      mojo::PendingRemote<viz::mojom::CompositorFrameSinkClient> client,
      mojo::PendingReceiver<viz::mojom::CompositorFrameSink> receiver,
      CreateFrameSinkCallback callback) override;
  void DestroyFrameSink(const viz::FrameSinkId& frame_sink_id) override;

 private:
  // Destroys every sink brokered to the connection that just went away. Nothing
  // else is watching the producer, so this is what unregisters its ids.
  void OnProducerDisconnected();

  const raw_ptr<viz::HostFrameSinkManager> host_frame_sink_manager_;
  const FrameSinkIdAllocator allocate_frame_sink_id_;

  mojo::ReceiverSet<mojom::FrameSinkBroker> receivers_;

  base::flat_map<viz::FrameSinkId, std::unique_ptr<BrokeredFrameSink>>
      frame_sink_map_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_FRAME_SINK_BROKER_H_
