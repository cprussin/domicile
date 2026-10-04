// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

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

// The browser's viz registration of one FrameSinkId, held while the producer
// submits to it.
//
// The non-renderer counterpart of content::EmbeddedFrameSinkImpl. Its parent
// is unknown at construction and arrives when a page embeds it; see Embed().
//
// Two modes, fixed by CreateCompositorFrameSink():
// - The producer passes its own client and receiver, which go straight to viz.
// - The producer has only dmabufs and no GPU channel, so the browser holds the
//   sink and builds frames via ImportBuffer/SubmitBuffer.
// See docs/architecture/ENGINE-FORK.md#buffer-import.
class BrokeredFrameSink : public viz::HostFrameSinkClient,
                          public viz::mojom::CompositorFrameSinkClient {
 public:
  // Returns the browser's SharedImageInterface, or null with no GPU (headless).
  // Injected because the only source is aura::Env and this target must not
  // depend on //ui/aura.
  using SharedImageInterfaceGetter =
      base::RepeatingCallback<gpu::SharedImageInterface*()>;

  BrokeredFrameSink(viz::HostFrameSinkManager* host_frame_sink_manager,
                    const viz::FrameSinkId& frame_sink_id,
                    mojo::PendingRemote<mojom::SurfaceObserver> observer,
                    mojo::ReceiverId owner,
                    const std::string& app_id,
                    SharedImageInterfaceGetter get_shared_image_interface);

  BrokeredFrameSink(const BrokeredFrameSink&) = delete;
  BrokeredFrameSink& operator=(const BrokeredFrameSink&) = delete;

  ~BrokeredFrameSink() override;

  const viz::FrameSinkId& frame_sink_id() const { return frame_sink_id_; }

  // The producer's id for this sink's window. A page's <app> element uses it
  // to pick which window to embed. Also the viz debug label.
  const std::string& app_id() const { return app_id_; }

  // The FrameSinkBroker connection that created this sink. A producer can only
  // destroy its own sinks, and loses them all on disconnect.
  mojo::ReceiverId owner() const { return owner_; }

  // Connects this id's CompositorFrameSink to viz. Null `client` and `receiver`
  // make the browser keep both ends, which ImportBuffer and SubmitBuffer need.
  void CreateCompositorFrameSink(
      mojo::PendingRemote<viz::mojom::CompositorFrameSinkClient> client,
      mojo::PendingReceiver<viz::mojom::CompositorFrameSink> receiver);

  // Records that the page shows `size` of this surface at `local_surface_id`
  // under `parent_frame_sink_id`. Registers the hierarchy so BeginFrames
  // arrive, and tells the producer which surface to submit to.
  //
  // `scale` is the page's device pixels per CSS pixel. The producer uses it to
  // convert `size` to the client's logical pixels; each monitor has its own.
  //
  // Ignores a `local_surface_id` older than the current one, since viz closes
  // a sink that submits to an older id.
  void Embed(const viz::FrameSinkId& parent_frame_sink_id,
             const viz::LocalSurfaceId& local_surface_id,
             const gfx::Size& size,
             double scale);

  // Imports a dmabuf as a SharedImage and returns its buffer id, or 0 on
  // failure. Follows components/exo/buffer.cc.
  //
  // Fills `exported` so a producer holding its own sink can reference the same
  // SharedImage. See docs/architecture/ENGINE-FORK.md#buffer-import.
  uint64_t ImportBuffer(gfx::GpuMemoryBufferHandle handle,
                        const gfx::Size& size,
                        uint32_t fourcc,
                        std::optional<gpu::ExportedSharedImage>* exported);

  // Submits a frame showing `buffer_id`. False if there is no such buffer, or
  // no surface to submit to yet.
  bool SubmitBuffer(uint64_t buffer_id, const gfx::Rect& damage);

  // Drops an imported buffer. Safe while viz still holds it: the SharedImage is
  // refcounted, and no release is sent for it.
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
  const std::string app_id_;

  // Null when the producer does not need surface or release notifications.
  mojo::Remote<mojom::SurfaceObserver> observer_;

  const mojo::ReceiverId owner_;
  const SharedImageInterfaceGetter get_shared_image_interface_;

  // The frame sink this one was last embedded under. Invalid until embedded.
  viz::FrameSinkId parent_frame_sink_id_;

  // Bound only when the browser owns the sink.
  mojo::Remote<viz::mojom::CompositorFrameSink> sink_;
  mojo::Receiver<viz::mojom::CompositorFrameSinkClient> client_receiver_{this};

  // The page's latest surface id and size. Nothing can be submitted until it
  // is set.
  viz::LocalSurfaceId local_surface_id_;
  gfx::Size size_;

  base::flat_map<uint64_t, ImportedBuffer> buffers_;
  uint64_t next_buffer_id_ = 1;
  viz::ResourceId next_resource_id_{1};
  // Maps each live resource id to its buffer, to report releases by buffer id.
  base::flat_map<viz::ResourceId, uint64_t> resource_to_buffer_;
  viz::FrameTokenGenerator next_frame_token_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_BROKERED_FRAME_SINK_H_
