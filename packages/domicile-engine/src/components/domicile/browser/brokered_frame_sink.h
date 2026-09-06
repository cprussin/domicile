// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_BROWSER_BROKERED_FRAME_SINK_H_
#define COMPONENTS_DOMICILE_BROWSER_BROKERED_FRAME_SINK_H_

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "base/containers/flat_map.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/scoped_refptr.h"
#include "components/domicile/mojom/frame_sink_broker.mojom.h"
#include "components/viz/common/frame_sinks/begin_frame_args.h"
#include "components/viz/common/frame_timing_details_map.h"
#include "components/viz/common/quads/compositor_frame_metadata.h"
#include "components/viz/common/resources/resource_id.h"
#include "components/viz/common/resources/returned_resource.h"
#include "components/viz/common/resources/transferable_resource.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "components/viz/common/surfaces/local_surface_id.h"
#include "components/viz/host/host_frame_sink_client.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/receiver_set.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "services/viz/public/mojom/compositing/compositor_frame_sink.mojom.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"
#include "ui/gfx/gpu_memory_buffer_handle.h"

namespace gpu {
class ClientSharedImage;
class SharedImageInterface;
struct ExportedSharedImage;
}  // namespace gpu

namespace viz {
class HostFrameSinkManager;
}

namespace domicile {

// A brokered frame sink: the browser's registration of one FrameSinkId with
// viz, held for as long as the producer wants to submit to it.
//
// This is the non-renderer counterpart of content::EmbeddedFrameSinkImpl, minus
// the hierarchy at construction: an embedded frame sink knows its parent then
// because embedder and embedded live in the same renderer, and a brokered one
// does not. Its parent arrives later, when a page embeds it — see Embed().
//
// **It has two shapes, and which one it is settled at construction.** A
// producer that submits its own CompositorFrames hands over a client and a
// receiver, and they are forwarded to viz; the browser never sees a frame. A
// producer with a dmabuf cannot do that — a TransferableResource names a
// mailbox and minting one needs a GPU channel it deliberately does not have —
// so it passes neither, the browser holds the sink and viz's client end, and
// ImportBuffer/SubmitBuffer are how frames get made. See
// docs/architecture/ENGINE-FORK.md, "Settled: broker the import".
class BrokeredFrameSink : public viz::HostFrameSinkClient,
                          public viz::mojom::CompositorFrameSinkClient {
 public:
  // How the browser reaches a GPU. Injected rather than reached for, because
  // the only way to one is aura::Env and this must not depend on //ui/aura —
  // the same reason the FrameSinkId allocator is injected. Returns null when
  // there is no GPU, which is every headless run.
  using SharedImageInterfaceGetter =
      base::RepeatingCallback<gpu::SharedImageInterface*()>;

  BrokeredFrameSink(viz::HostFrameSinkManager* host_frame_sink_manager,
                    const viz::FrameSinkId& frame_sink_id,
                    mojo::PendingRemote<mojom::SurfaceObserver> observer,
                    mojo::ReceiverId owner,
                    const std::string& debug_label,
                    SharedImageInterfaceGetter get_shared_image_interface);

  BrokeredFrameSink(const BrokeredFrameSink&) = delete;
  BrokeredFrameSink& operator=(const BrokeredFrameSink&) = delete;

  ~BrokeredFrameSink() override;

  const viz::FrameSinkId& frame_sink_id() const { return frame_sink_id_; }

  // The FrameSinkBroker connection that asked for this sink. A producer only
  // gets to destroy its own, and loses all of them when it disconnects.
  mojo::ReceiverId owner() const { return owner_; }

  // Creates the CompositorFrameSink connection to viz for this id. A null
  // `client` and `receiver` mean the browser keeps both ends, which is what
  // ImportBuffer and SubmitBuffer need.
  void CreateCompositorFrameSink(
      mojo::PendingRemote<viz::mojom::CompositorFrameSinkClient> client,
      mojo::PendingReceiver<viz::mojom::CompositorFrameSink> receiver);

  // An embedder — the page — is showing `size` of this sink's surface at
  // `local_surface_id`, under the frame sink `parent_frame_sink_id`. Registers
  // the hierarchy so BeginFrames arrive, and tells the producer which surface
  // it is submitting to.
  //
  // Registering the hierarchy is deliberately here rather than at construction:
  // until a page embeds, there is no parent to name, and step 2 established
  // that hierarchy is about BeginFrames rather than about getting drawn.
  void Embed(const viz::FrameSinkId& parent_frame_sink_id,
             const viz::LocalSurfaceId& local_surface_id,
             const gfx::Size& size);

  // Imports a dmabuf and returns the id to name it by, or 0. This is the
  // components/exo/buffer.cc path: a GpuMemoryBufferHandle becomes a
  // SharedImage, and a SharedImage becomes a TransferableResource the producer
  // never has to see.
  // `exported` is filled with something another client can name the same
  // SharedImage by, so that a producer holding its own sink can submit its own
  // frames. See ENGINE-FORK.md, "Whether the producer can submit its own
  // frames".
  uint64_t ImportBuffer(gfx::GpuMemoryBufferHandle handle,
                        const gfx::Size& size,
                        std::optional<gpu::ExportedSharedImage>* exported);

  // Submits a frame showing `buffer_id`. False if there is no such buffer, or
  // no surface to submit to yet.
  bool SubmitBuffer(uint64_t buffer_id, const gfx::Rect& damage);

  // Drops an imported buffer. Safe while viz still holds it: the SharedImage
  // outlives this by its own refcount, and the release never arrives.
  void DestroyBuffer(uint64_t buffer_id);

  // viz::HostFrameSinkClient implementation.
  void OnFirstSurfaceActivation(const viz::SurfaceInfo& surface_info) override;
  void OnFrameTokenChanged(uint32_t frame_token,
                           base::TimeTicks activation_time) override;

  // viz::mojom::CompositorFrameSinkClient implementation. Only reached when the
  // browser owns the sink.
  void DidReceiveCompositorFrameAck(
      std::vector<viz::ReturnedResource> resources) override;
  void OnBeginFrame(const viz::BeginFrameArgs& args,
                    const viz::FrameTimingDetailsMap& timing_details,
                    std::vector<viz::ReturnedResource> resources) override;
  void OnBeginFramePausedChanged(bool paused) override;
  void ReclaimResources(std::vector<viz::ReturnedResource> resources) override;
  void OnCompositorFrameTransitionDirectiveProcessed(
      uint32_t sequence_id) override;
  void OnSurfaceEvicted(const viz::LocalSurfaceId& local_surface_id) override;

 private:
  // One imported dmabuf, alive from ImportBuffer until DestroyBuffer.
  struct ImportedBuffer {
    ImportedBuffer();
    ImportedBuffer(ImportedBuffer&&);
    ImportedBuffer& operator=(ImportedBuffer&&);
    ~ImportedBuffer();

    scoped_refptr<gpu::ClientSharedImage> shared_image;
    viz::TransferableResource resource;
    gfx::Size size;
  };

  // Turns viz's returned resources into wl_buffer.release, by way of the
  // resource id each buffer was submitted under.
  void ReleaseReturnedResources(
      const std::vector<viz::ReturnedResource>& resources);

  const raw_ptr<viz::HostFrameSinkManager> host_frame_sink_manager_;
  const viz::FrameSinkId frame_sink_id_;

  // Null for a producer that does not want to be told, which is every producer
  // that will never submit — the sink alone is useless without the surface.
  mojo::Remote<mojom::SurfaceObserver> observer_;

  const mojo::ReceiverId owner_;
  const SharedImageInterfaceGetter get_shared_image_interface_;

  // Whichever frame sink this one was last embedded under, invalid until some
  // page has embedded it.
  viz::FrameSinkId parent_frame_sink_id_;

  // Where the producer's frames go when the browser owns the sink. Unbound when
  // the producer kept its own.
  mojo::Remote<viz::mojom::CompositorFrameSink> sink_;
  mojo::Receiver<viz::mojom::CompositorFrameSinkClient> client_receiver_{this};

  // What the page last told us to render at. Nothing can be submitted before
  // this arrives, because a frame needs a LocalSurfaceId to go to.
  viz::LocalSurfaceId local_surface_id_;
  gfx::Size size_;

  base::flat_map<uint64_t, ImportedBuffer> buffers_;
  uint64_t next_buffer_id_ = 1;
  viz::ResourceId next_resource_id_{1};
  // Which buffer each live resource id belongs to, so a returned resource can
  // be named back to the producer as the buffer it lent us.
  base::flat_map<viz::ResourceId, uint64_t> resource_to_buffer_;
  viz::FrameTokenGenerator next_frame_token_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_BROKERED_FRAME_SINK_H_
