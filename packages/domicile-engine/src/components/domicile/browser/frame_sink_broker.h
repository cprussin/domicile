// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_BROWSER_FRAME_SINK_BROKER_H_
#define COMPONENTS_DOMICILE_BROWSER_FRAME_SINK_BROKER_H_

#include <memory>
#include <optional>
#include <vector>

#include "base/containers/flat_map.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "components/domicile/mojom/frame_sink_broker.mojom.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "components/viz/common/surfaces/local_surface_id.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/receiver_set.h"
#include "ui/gfx/geometry/size.h"

namespace viz {
class HostFrameSinkManager;
}

namespace domicile {

class BrokeredFrameSink;

// Brokers viz frame sinks to a compositing producer that is not a renderer, and
// introduces each one to the page that embeds it.
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
//
// Producers reach this over mojo. Embedders — pages — do not: they get the
// narrow mojom::ExternalSurfaceProvider, which can ask to embed and nothing
// else. Holding a FrameSinkBroker pipe is unrestricted authority to allocate
// frame sinks in viz, and that is not authority a renderer may hold.
class FrameSinkBroker : public mojom::FrameSinkBroker {
 public:
  using FrameSinkIdAllocator = base::RepeatingCallback<viz::FrameSinkId()>;
  using EmbedCallback =
      base::OnceCallback<void(const std::optional<viz::FrameSinkId>&)>;

  FrameSinkBroker(viz::HostFrameSinkManager* host_frame_sink_manager,
                  FrameSinkIdAllocator allocate_frame_sink_id);

  FrameSinkBroker(const FrameSinkBroker&) = delete;
  FrameSinkBroker& operator=(const FrameSinkBroker&) = delete;

  ~FrameSinkBroker() override;

  void Bind(mojo::PendingReceiver<mojom::FrameSinkBroker> receiver);

  // An embedder has allocated `local_surface_id` and will show `size` of a
  // brokered surface under `parent_frame_sink_id`. Registers the hierarchy,
  // tells the producer which surface that is, and runs `callback` with the
  // FrameSinkId to pair the LocalSurfaceId with.
  //
  // The two halves of the SurfaceId come from opposite sides on purpose. The
  // browser owns the FrameSinkId because it owns the namespace; the page owns
  // the LocalSurfaceId because it is the embedder, and the embed_token in it is
  // the capability the producer needs. This is RemoteFrame's split.
  //
  // `callback` is deferred until some producer has been brokered a sink. An
  // <app> element exists before the client window behind it does, so a page
  // that embeds early waits rather than failing, and is answered when a
  // producer turns up.
  void Embed(const viz::FrameSinkId& parent_frame_sink_id,
             const viz::LocalSurfaceId& local_surface_id,
             const gfx::Size& size,
             EmbedCallback callback);

  // mojom::FrameSinkBroker implementation.
  void CreateFrameSink(
      mojo::PendingRemote<viz::mojom::CompositorFrameSinkClient> client,
      mojo::PendingReceiver<viz::mojom::CompositorFrameSink> receiver,
      mojo::PendingRemote<mojom::SurfaceObserver> observer,
      CreateFrameSinkCallback callback) override;
  void DestroyFrameSink(const viz::FrameSinkId& frame_sink_id) override;

 private:
  // A page that asked to embed before any producer had connected.
  struct PendingEmbed {
    PendingEmbed(const viz::FrameSinkId& parent_frame_sink_id,
                 const viz::LocalSurfaceId& local_surface_id,
                 const gfx::Size& size,
                 EmbedCallback callback);
    PendingEmbed(PendingEmbed&&);
    PendingEmbed& operator=(PendingEmbed&&);
    ~PendingEmbed();

    viz::FrameSinkId parent_frame_sink_id;
    viz::LocalSurfaceId local_surface_id;
    gfx::Size size;
    EmbedCallback callback;
  };

  // The sink an embedder that names none gets. There is one producer in the
  // spike; keying a surface to the app that owns it is what the chrome protocol
  // will do, and it is not this layer's business.
  BrokeredFrameSink* MostRecentlyBrokeredSink();

  // Destroys every sink brokered to the connection that just went away. Nothing
  // else is watching the producer, so this is what unregisters its ids.
  void OnProducerDisconnected();

  const raw_ptr<viz::HostFrameSinkManager> host_frame_sink_manager_;
  const FrameSinkIdAllocator allocate_frame_sink_id_;

  mojo::ReceiverSet<mojom::FrameSinkBroker> receivers_;

  base::flat_map<viz::FrameSinkId, std::unique_ptr<BrokeredFrameSink>>
      frame_sink_map_;

  // The last id CreateFrameSink handed out. Looked up in `frame_sink_map_`
  // rather than trusted, so a sink that has since gone away reads as none.
  viz::FrameSinkId most_recently_brokered_;

  std::vector<PendingEmbed> pending_embeds_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_FRAME_SINK_BROKER_H_
