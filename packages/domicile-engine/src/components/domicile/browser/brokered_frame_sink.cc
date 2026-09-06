// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/browser/brokered_frame_sink.h"

#include <optional>
#include <utility>

#include "base/logging.h"
#include "base/time/time.h"
#include "components/viz/common/quads/compositor_frame.h"
#include "components/viz/common/quads/compositor_render_pass.h"
#include "components/viz/common/quads/texture_draw_quad.h"
#include "components/viz/common/surfaces/surface_info.h"
#include "components/viz/host/host_frame_sink_manager.h"
#include "gpu/command_buffer/client/client_shared_image.h"
#include "gpu/command_buffer/client/shared_image_interface.h"
#include "gpu/command_buffer/common/shared_image_usage.h"
#include "gpu/command_buffer/common/sync_token.h"
#include "ui/gfx/color_space.h"
#include "ui/gfx/geometry/transform.h"

namespace domicile {
namespace {

// What a window is: sampled by the display compositor, and nothing more.
//
// Not SCANOUT, which is what would let viz promote the quad to an overlay. A
// SharedImage may only claim it if the buffer behind it was allocated for it,
// and on a render node with no KMS behind it gbm refuses that — measured on
// crux, where the NVIDIA backend gives out GBM_BO_USE_LINEAR buffers and
// nothing more. Claiming it anyway produces a SharedImage that is created and
// then never drawn. Overlay promotion is phase 3's, with a real display.
constexpr gpu::SharedImageUsageSet kWindowUsage =
    gpu::SHARED_IMAGE_USAGE_DISPLAY_READ;

}  // namespace

BrokeredFrameSink::ImportedBuffer::ImportedBuffer() = default;
BrokeredFrameSink::ImportedBuffer::ImportedBuffer(ImportedBuffer&&) = default;
BrokeredFrameSink::ImportedBuffer&
BrokeredFrameSink::ImportedBuffer::operator=(ImportedBuffer&&) = default;
BrokeredFrameSink::ImportedBuffer::~ImportedBuffer() = default;

BrokeredFrameSink::BrokeredFrameSink(
    viz::HostFrameSinkManager* host_frame_sink_manager,
    const viz::FrameSinkId& frame_sink_id,
    mojo::PendingRemote<mojom::SurfaceObserver> observer,
    mojo::ReceiverId owner,
    const std::string& debug_label,
    SharedImageInterfaceGetter get_shared_image_interface)
    : host_frame_sink_manager_(host_frame_sink_manager),
      frame_sink_id_(frame_sink_id),
      observer_(std::move(observer)),
      owner_(owner),
      get_shared_image_interface_(std::move(get_shared_image_interface)) {
  host_frame_sink_manager_->RegisterFrameSinkId(
      frame_sink_id_, this, viz::ReportFirstSurfaceActivation::kNo);
  // What the producer calls this window, so that a viz trace names the app
  // rather than the mechanism.
  host_frame_sink_manager_->SetFrameSinkDebugLabel(
      frame_sink_id_, debug_label.empty() ? "BrokeredFrameSink" : debug_label);
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
  // A producer that brought its own ends gets them forwarded and is viz's
  // client from here; the browser is out of its frame path entirely.
  if (client && receiver) {
    host_frame_sink_manager_->CreateCompositorFrameSink(
        frame_sink_id_, std::move(receiver), std::move(client));
    return;
  }

  // Otherwise the browser is the client, because it is the one that will be
  // assembling the frames.
  host_frame_sink_manager_->CreateCompositorFrameSink(
      frame_sink_id_, sink_.BindNewPipeAndPassReceiver(),
      client_receiver_.BindNewPipeAndPassRemote());
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

  local_surface_id_ = local_surface_id;
  size_ = size;

  // Only worth asking for when the browser is the one being asked: a producer
  // holding its own sink calls SetNeedsBeginFrame itself.
  if (sink_) {
    sink_->SetNeedsBeginFrame(true);
  }

  if (observer_) {
    observer_->OnSurfaceEmbedded(local_surface_id, size);
  }
}

uint64_t BrokeredFrameSink::ImportBuffer(gfx::GpuMemoryBufferHandle handle,
                                         const gfx::Size& size) {
  gpu::SharedImageInterface* sii = get_shared_image_interface_.Run();
  if (!sii) {
    LOG(ERROR) << "domicile: no GPU to import a buffer into. The ozone "
                  "platform must be one that implements "
                  "CreateNativePixmapFromHandle — headless does not.";
    return 0;
  }

  // The whole of the exo::Buffer port. Everything else that file does — texture
  // caching, release fences, protected content, YUV — is either viz's job on
  // this side of the seam or not phase 1's.
  scoped_refptr<gpu::ClientSharedImage> shared_image = sii->CreateSharedImage(
      {viz::SinglePlaneFormat::kRGBA_8888, size, gfx::ColorSpace::CreateSRGB(),
       kWindowUsage, "DomicileWindow"},
      std::move(handle));
  if (!shared_image) {
    LOG(ERROR) << "domicile: the GPU refused the dmabuf";
    return 0;
  }

  ImportedBuffer buffer;
  buffer.size = size;
  buffer.resource = viz::TransferableResource::Make(
      shared_image, viz::TransferableResource::ResourceSource::kUI,
      sii->GenVerifiedSyncToken());
  buffer.resource.id = next_resource_id_;
  next_resource_id_ = viz::ResourceId(next_resource_id_.GetUnsafeValue() + 1);
  buffer.shared_image = std::move(shared_image);

  const uint64_t buffer_id = next_buffer_id_++;
  resource_to_buffer_[buffer.resource.id] = buffer_id;
  buffers_[buffer_id] = std::move(buffer);
  return buffer_id;
}

bool BrokeredFrameSink::SubmitBuffer(uint64_t buffer_id,
                                     const gfx::Rect& damage) {
  auto iter = buffers_.find(buffer_id);
  if (iter == buffers_.end() || !sink_ || !local_surface_id_.is_valid()) {
    LOG(ERROR) << "domicile: nothing to submit — buffer "
               << (iter == buffers_.end() ? "unknown" : "known") << ", sink "
               << (sink_ ? "bound" : "unbound") << ", surface "
               << (local_surface_id_.is_valid() ? "embedded" : "not embedded");
    return false;
  }
  const ImportedBuffer& buffer = iter->second;
  const gfx::Rect rect(size_);

  auto pass = viz::CompositorRenderPass::Create();
  pass->SetNew(viz::CompositorRenderPassId{1}, rect,
               damage.IsEmpty() ? rect : damage, gfx::Transform());

  viz::SharedQuadState* quad_state = pass->CreateAndAppendSharedQuadState();
  quad_state->SetAll(gfx::Transform(),
                     /*layer_rect=*/rect,
                     /*visible_layer_rect=*/rect,
                     /*filter_info=*/gfx::MaskFilterInfo(),
                     /*clip=*/std::nullopt,
                     /*contents_opaque=*/true,
                     /*opacity_f=*/1.f,
                     /*blend=*/SkBlendMode::kSrcOver,
                     /*sorting_context=*/0,
                     /*layer_id=*/0u,
                     /*fast_rounded_corner=*/false);

  // The quad the whole design is for: the client's own buffer, as a texture viz
  // can promote to an overlay rather than copy.
  viz::TextureDrawQuad* quad =
      pass->CreateAndAppendDrawQuad<viz::TextureDrawQuad>();
  quad->SetNew(quad_state, rect, rect,
               /*needs_blending=*/false, buffer.resource.id,
               /*top_left=*/gfx::PointF(0.f, 0.f),
               /*bottom_right=*/gfx::PointF(1.f, 1.f),
               /*background_color=*/SkColors::kTransparent,
               /*nearest_neighbor=*/false,
               /*secure_output_only=*/false, gfx::ProtectedVideoType::kClear,
               /*is_tex_coords_normalized=*/true);

  viz::CompositorFrame frame;
  frame.metadata.begin_frame_ack =
      viz::BeginFrameAck::CreateManualAckWithDamage();
  frame.metadata.device_scale_factor = 1.f;
  frame.metadata.frame_token = ++next_frame_token_;
  frame.resource_list.push_back(buffer.resource);
  frame.render_pass_list.push_back(std::move(pass));

  sink_->SubmitCompositorFrame(local_surface_id_, std::move(frame),
                               /*hit_test_region_list=*/std::nullopt,
                               /*submit_time=*/0);
  return true;
}

void BrokeredFrameSink::DestroyBuffer(uint64_t buffer_id) {
  auto iter = buffers_.find(buffer_id);
  if (iter == buffers_.end()) {
    return;
  }
  resource_to_buffer_.erase(iter->second.resource.id);
  buffers_.erase(iter);
}

void BrokeredFrameSink::ReleaseReturnedResources(
    const std::vector<viz::ReturnedResource>& resources) {
  if (!observer_) {
    return;
  }
  for (const viz::ReturnedResource& resource : resources) {
    auto iter = resource_to_buffer_.find(resource.id);
    if (iter == resource_to_buffer_.end()) {
      continue;
    }
    // wl_buffer.release. The producer may draw into that dmabuf again, and not
    // one moment sooner.
    observer_->OnBufferReleased(iter->second);
  }
}

void BrokeredFrameSink::DidReceiveCompositorFrameAck(
    std::vector<viz::ReturnedResource> resources) {
  ReleaseReturnedResources(resources);
}

void BrokeredFrameSink::OnBeginFrame(
    const viz::BeginFrameArgs& args,
    const viz::FrameTimingDetailsMap& timing_details,
    std::vector<viz::ReturnedResource> resources) {
  ReleaseReturnedResources(resources);
  if (observer_) {
    observer_->OnFrame(args.deadline.since_origin().InMicroseconds());
  }
}

void BrokeredFrameSink::ReclaimResources(
    std::vector<viz::ReturnedResource> resources) {
  ReleaseReturnedResources(resources);
}

void BrokeredFrameSink::OnBeginFramePausedChanged(bool paused) {}

void BrokeredFrameSink::OnCompositorFrameTransitionDirectiveProcessed(
    uint32_t sequence_id) {}

void BrokeredFrameSink::OnSurfaceEvicted(
    const viz::LocalSurfaceId& local_surface_id) {}

// The producer's LocalSurfaceIds come from the embedder, which allocates them,
// so the browser has nothing to learn from activation. Registration asks for
// ReportFirstSurfaceActivation::kNo and these are never called.
void BrokeredFrameSink::OnFirstSurfaceActivation(
    const viz::SurfaceInfo& surface_info) {}

void BrokeredFrameSink::OnFrameTokenChanged(uint32_t frame_token,
                                            base::TimeTicks activation_time) {}

}  // namespace domicile
