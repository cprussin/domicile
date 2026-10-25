// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/domicile_engine.h"

#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <type_traits>
#include <utility>
#include <vector>

#include "base/at_exit.h"
#include "base/check_op.h"
#include "base/compiler_specific.h"
#include "base/containers/circular_deque.h"
#include "base/containers/span.h"
#include "base/containers/flat_map.h"
#include "base/files/scoped_file.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/message_loop/message_pump_type.h"
#include "base/memory/platform_shared_memory_region.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/read_only_shared_memory_region.h"
#include "base/memory/unsafe_shared_memory_region.h"
#include "base/unguessable_token.h"
#include "base/no_destructor.h"
#include "base/notreached.h"
#include "base/run_loop.h"
#include "base/synchronization/waitable_event.h"
#include "base/task/single_thread_task_runner.h"
#include "base/threading/thread.h"
#include "base/time/time.h"
#include "components/domicile/common/synced_frame.h"
#include "components/domicile/engine/engine_event_queue.h"
#include "components/domicile/engine/domicile_engine_spike.h"
#include "components/domicile/engine/probe_wait.h"
#include "components/domicile/engine/surface_alpha.h"
#include "components/domicile/engine/surface_crop.h"
#include "components/domicile/engine/surface_frames.h"
#include "components/domicile/engine/surface_submits.h"
#include "components/domicile/engine/surface_transform.h"
#include "components/domicile/mojom/control_channel.mojom.h"
#include "components/domicile/mojom/frame_sink_broker.mojom.h"
#include "components/domicile/spike/mojom/spike_probe.mojom.h"
#include "base/posix/eintr_wrapper.h"
#include "components/viz/common/frame_sinks/begin_frame_args.h"
#include "components/viz/common/frame_timing_details_map.h"
#include "components/viz/common/quads/compositor_frame.h"
#include "components/viz/common/quads/compositor_render_pass.h"
#include "components/viz/common/quads/texture_draw_quad.h"
#include "components/viz/common/resources/returned_resource.h"
#include "components/viz/common/resources/transferable_resource.h"
#include "gpu/command_buffer/client/client_shared_image.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "components/viz/common/surfaces/local_surface_id.h"
#include "mojo/core/embedder/embedder.h"
#include "mojo/core/embedder/scoped_ipc_support.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "mojo/public/cpp/platform/named_platform_channel.h"
#include "mojo/public/cpp/platform/platform_channel_endpoint.h"
#include "mojo/public/cpp/system/invitation.h"
#include "services/viz/public/mojom/compositing/compositor_frame_sink.mojom.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/geometry/size.h"
#include "ui/gfx/gpu_memory_buffer_handle.h"
#include "ui/gfx/geometry/transform.h"
#include "ui/gfx/gpu_fence_handle.h"
#include "ui/gfx/native_pixmap_handle.h"
#include "ui/gfx/presentation_feedback.h"

namespace domicile {
namespace {

// Must match content/browser/domicile/domicile_frame_sink_broker.cc. Integer
// names because ipcz indexes attachments by the first four bytes of the name,
// so string names collide on index 0.
constexpr uint64_t kBrokerPipeName = 0;
// Throwaway; see domicile_engine_spike.h.
constexpr uint64_t kProbePipeName = 1;
// How long a spike probe waits for the browser: longer than a guard's whole
// leg, which takes 15 to 40 seconds.
constexpr base::TimeDelta kProbePatience = base::Seconds(30);

// The type text crosses the broker under. The browser offers it under every
// text type a reader asks for (see DomicileTextMimeTypes in
// ui/ozone/platform/drm/domicile/drm_clipboard.h).
constexpr char kClipboardText[] = "text/plain;charset=utf-8";

// Initializes the AtExitManager and mojo core once per process.
//
// The compositor is not a Chromium process, so the library provides both. They
// cannot be torn down and re-created, so they outlive every engine.
void EnsureMojoInitialized() {
  static base::NoDestructor<base::AtExitManager> at_exit;
  static bool initialized = [] {
    mojo::core::Init();
    return true;
  }();
  (void)at_exit;
  (void)initialized;
}

// One brokered frame sink.
//
// Runs entirely on the engine's mojo thread and reports to the compositor only
// through the EngineEventQueue. It assembles its own CompositorFrames from
// SharedImages the browser imports; see ENGINE-FORK.md#buffer-import.
class Surface : public mojom::SurfaceObserver,
                public viz::mojom::CompositorFrameSinkClient {
 public:
  Surface(DomicileSurfaceId id, EngineEventQueue* queue)
      : id_(id), queue_(queue) {}

  Surface(const Surface&) = delete;
  Surface& operator=(const Surface&) = delete;

  ~Surface() override = default;

  void Create(mojom::FrameSinkBroker* broker,
              const std::string& app_id,
              base::OnceCallback<void(bool)> done) {
    mojo::PendingRemote<viz::mojom::CompositorFrameSinkClient> client;
    client_receiver_.Bind(client.InitWithNewPipeAndPassReceiver());
    broker->CreateFrameSink(
        std::move(client), sink_.BindNewPipeAndPassReceiver(),
        observer_receiver_.BindNewPipeAndPassRemote(), app_id,
        base::BindOnce(&Surface::OnCreated, base::Unretained(this),
                       std::move(done)));
    // Viz closes the sink on a frame it rejects, e.g. one whose size differs
    // from its surface's. Nothing reconnects it, so every later frame of this
    // window is lost; say so rather than freeze silently.
    sink_.set_disconnect_with_reason_handler(base::BindOnce(
        [](const std::string& app_id, uint32_t reason,
           const std::string& description) {
          LOG(ERROR) << "domicile: the frame sink for \"" << app_id
                     << "\" closed (" << reason << ": " << description
                     << "); its window will draw nothing more";
        },
        app_id));
  }

  const viz::FrameSinkId& frame_sink_id() const { return frame_sink_id_; }

  // Wraps the browser's SharedImage as a resource for later Submit calls.
  // `has_alpha` comes from FourccHasAlpha.
  void Adopt(uint64_t buffer_id,
             gpu::ExportedSharedImage exported,
             bool has_alpha) {
    scoped_refptr<gpu::ClientSharedImage> shared_image =
        gpu::ClientSharedImage::ImportUnowned(std::move(exported));
    if (!shared_image) {
      return;
    }
    viz::TransferableResource resource = viz::TransferableResource::Make(
        shared_image, viz::TransferableResource::ResourceSource::kUI,
        shared_image->creation_sync_token());
    resource.id = next_resource_id_;
    next_resource_id_ = viz::ResourceId(next_resource_id_.GetUnsafeValue() + 1);
    resource_to_buffer_[resource.id] = buffer_id;
    buffers_[buffer_id] = {std::move(shared_image), std::move(resource),
                           has_alpha};
  }

  void Forget(uint64_t buffer_id) {
    auto iter = buffers_.find(buffer_id);
    if (iter != buffers_.end()) {
      resource_to_buffer_.erase(iter->second.resource.id);
      buffers_.erase(iter);
    }
  }

  // Sends `submit` to viz, unless an earlier submit waits for its fence.
  void Submit(const SurfaceSubmit& submit) {
    Send(submits_.Push(AtFrame(submit)));
  }

  // Holds `submit` until the browser puts its buffer's acquire fence in
  // place. Returns the ticket for Fenced.
  uint64_t Hold(const SurfaceSubmit& submit) {
    return submits_.Hold(AtFrame(submit));
  }

  // Later submits go up at synced frame `frame`. Frames only grow, because
  // viz refuses a surface id older than the last.
  void Sync(uint32_t frame) {
    CHECK_GT(frame, frame_) << "domicile: synced frames must grow";
    frame_ = frame;
  }

  // The browser put `ticket`'s fence in place behind `sync_token`, or refused
  // it when `sync_token` is nullopt.
  void Fenced(uint64_t ticket,
              const std::optional<gpu::SyncToken>& sync_token) {
    Send(submits_.Fenced(ticket, sync_token));
  }

 private:
  // Stamped when queued, not when sent, so a submit held behind a fence keeps
  // the frame it was made in.
  SurfaceSubmit AtFrame(const SurfaceSubmit& submit) const {
    SurfaceSubmit stamped = submit;
    stamped.frame = frame_;
    return stamped;
  }

  void Send(const std::vector<SurfaceSubmit>& ready) {
    for (const SurfaceSubmit& submit : ready) {
      SubmitNow(submit);
    }
  }

  // Shows `submit.buffer` at the newest box numbered at most `submit.box`. A
  // client's buffer is drawn for the box it acked, so an old buffer stays at
  // its old size and id: viz keeps the page's frame waiting for the new one
  // rather than stretching the old one over it.
  void SubmitNow(const SurfaceSubmit& submit) {
    auto iter = buffers_.find(submit.buffer);
    if (iter == buffers_.end() || boxes_.empty() || submit.fence_refused) {
      if (submit.fence_refused) {
        LOG(ERROR) << "domicile: the browser would not fence buffer "
                   << submit.buffer << ", so its frame is dropped";
        // The buffer may be unfinished, so viz must not read it. Viz never
        // had it, so nothing else gives it back.
        queue_->Push({.type = EngineEvent::Type::kReleased,
                      .surface = id_,
                      .buffer = submit.buffer});
      }
      // Viz never sees it, so nothing else reports it, and the compositor
      // counts every submit.
      const uint64_t number = frames_.Dropped();
      queue_->Push({.type = EngineEvent::Type::kFrameDone,
                    .surface = id_,
                    .frame = number});
      queue_->Push({.type = EngineEvent::Type::kPresented,
                    .surface = id_,
                    .frame = number,
                    .flags = DOMICILE_PRESENTED_DISCARDED});
      return;
    }
    const gfx::Rect& crop = submit.crop;
    const gfx::Rect& damage = submit.damage;
    // Viz refuses a frame at an older LocalSurfaceId than one it has, so a
    // box once shown is never shown again after a newer one.
    while (boxes_.size() > 1 && boxes_[1].number <= submit.box) {
      boxes_.pop_front();
    }
    const Box& shown = boxes_.front();
    const gfx::Rect rect(shown.size);
    // Blend buffers with alpha, such as a menu's transparent rounded corners.
    const bool opaque = !iter->second.has_alpha;

    auto pass = viz::CompositorRenderPass::Create();
    pass->SetNew(viz::CompositorRenderPassId{1}, rect,
                 damage.IsEmpty() ? rect : damage, gfx::Transform());

    // Drawn in the buffer's orientation, then turned onto the box.
    const domicile::BufferQuad placed =
        domicile::QuadForBuffer(submit.transform, shown.size);

    viz::SharedQuadState* quad_state = pass->CreateAndAppendSharedQuadState();
    quad_state->SetAll(placed.to_box, placed.rect, placed.rect,
                       gfx::MaskFilterInfo(),
                       /*clip=*/std::nullopt, /*contents_opaque=*/opaque,
                       /*opacity_f=*/1.f, SkBlendMode::kSrcOver,
                       /*sorting_context=*/0, /*layer_id=*/0u,
                       /*fast_rounded_corner=*/false);

    // Sample only the window, excluding any client-drawn shadow.
    const gfx::RectF uv =
        CropToUv(crop, iter->second.shared_image->size());
    viz::TextureDrawQuad* quad =
        pass->CreateAndAppendDrawQuad<viz::TextureDrawQuad>();
    quad->SetNew(quad_state, placed.rect, placed.rect,
                 /*needs_blending=*/!opaque,
                 iter->second.resource.id, uv.origin(), uv.bottom_right(),
                 SkColors::kTransparent,
                 /*nearest_neighbor=*/false, /*secure_output_only=*/false,
                 gfx::ProtectedVideoType::kClear,
                 /*is_tex_coords_normalized=*/true);

    viz::CompositorFrame frame;
    frame.metadata.begin_frame_ack =
        viz::BeginFrameAck::CreateManualAckWithDamage();
    frame.metadata.device_scale_factor = 1.f;
    frame.metadata.frame_token = ++next_frame_token_;
    frames_.Sent(frame.metadata.frame_token);
    viz::TransferableResource resource = iter->second.resource;
    // Viz waits on the token, which comes after the creation token on the
    // same stream, so it orders viz's read after the fence too.
    if (submit.sync_token.HasData()) {
      resource.set_sync_token(submit.sync_token);
    }
    frame.resource_list.push_back(resource);
    frame.render_pass_list.push_back(std::move(pass));

    sink_->SubmitCompositorFrame(
        AtSyncedFrame(shown.local_surface_id, submit.frame), std::move(frame),
        std::nullopt, 0);
  }

  void OnCreated(base::OnceCallback<void(bool)> done,
                 const viz::FrameSinkId& frame_sink_id) {
    frame_sink_id_ = frame_sink_id;
    std::move(done).Run(frame_sink_id.is_valid());
  }

  // mojom::SurfaceObserver:
  //
  // The page chose this id and size. Forwarded as xdg_toplevel.configure.
  void OnSurfaceEmbedded(const viz::LocalSurfaceId& local_surface_id,
                         const gfx::Size& size,
                         double scale) override {
    boxes_.push_back({.number = ++last_box_,
                      .local_surface_id = local_surface_id,
                      .size = size});
    queue_->Push({.type = EngineEvent::Type::kConfigure,
                  .surface = id_,
                  .width = static_cast<uint32_t>(size.width()),
                  .height = static_cast<uint32_t>(size.height()),
                  .scale = scale,
                  .box = last_box_});
  }

  // Sent only when the browser owns the sink, which this does not request.
  void OnBufferReleased(uint64_t buffer_id) override {}

  // viz::mojom::CompositorFrameSinkClient:
  //
  // Frames follow the client's commits, so this sink never asks for
  // BeginFrames and the compositor is not woken each vsync. Viz still sends
  // one to deliver a frame's presentation timing, which goes to the
  // compositor as `presented`. Viz then expects damage from this surface
  // (SurfaceDamageExpected), so an unanswered one makes the display wait for
  // this window until the deadline. Releases do not depend on it: viz returns
  // them with a frame's ack or in ReclaimResources.
  void OnBeginFrame(const viz::BeginFrameArgs& args,
                    const viz::FrameTimingDetailsMap& timing_details,
                    std::vector<viz::ReturnedResource> resources) override {
    Release(resources);
    for (const auto& [frame_token, details] : timing_details) {
      const std::optional<uint64_t> number = frames_.Presented(frame_token);
      if (number.has_value()) {
        Present(*number, details.presentation_feedback);
      }
    }
    sink_->DidNotProduceFrame(viz::BeginFrameAck(args, /*has_damage=*/false));
  }
  // Viz takes the next frame once it acks this one, so the compositor answers
  // the client's wl_surface.frame then.
  void DidReceiveCompositorFrameAck(
      std::vector<viz::ReturnedResource> resources) override {
    Release(resources);
    const std::optional<uint64_t> number = frames_.Acked();
    if (!number.has_value()) {
      LOG(ERROR) << "domicile: viz acked a frame this window never sent";
      return;
    }
    queue_->Push({.type = EngineEvent::Type::kFrameDone,
                  .surface = id_,
                  .frame = *number});
  }
  void ReclaimResources(
      std::vector<viz::ReturnedResource> resources) override {
    Release(resources);
  }
  void OnBeginFramePausedChanged(bool paused) override {}
  void OnCompositorFrameTransitionDirectiveProcessed(
      uint32_t sequence_id) override {}
  void OnSurfaceEvicted(const viz::LocalSurfaceId& local_surface_id) override {}

  // Forwards a frame's presentation feedback as wp_presentation_feedback.
  // TimeTicks counts CLOCK_MONOTONIC on Linux, so it crosses as is.
  void Present(uint64_t number, const gfx::PresentationFeedback& feedback) {
    const uint32_t flags = PresentedFlagsOf(feedback.flags);
    const bool shown = flags != DOMICILE_PRESENTED_DISCARDED;
    queue_->Push(
        {.type = EngineEvent::Type::kPresented,
         .surface = id_,
         .frame = number,
         .time_ns = shown ? (feedback.timestamp - base::TimeTicks())
                                .InNanoseconds()
                          : 0,
         .refresh_ns = shown ? feedback.interval.InNanoseconds() : 0,
         .flags = flags});
  }

  // Forwards returned resources as wl_buffer.release, so the client may draw
  // into the buffer again.
  void Release(const std::vector<viz::ReturnedResource>& resources) {
    for (const viz::ReturnedResource& resource : resources) {
      auto iter = resource_to_buffer_.find(resource.id);
      if (iter == resource_to_buffer_.end()) {
        continue;
      }
      queue_->Push({.type = EngineEvent::Type::kReleased,
                    .surface = id_,
                    .buffer = iter->second});
    }
  }

  struct Adopted {
    scoped_refptr<gpu::ClientSharedImage> shared_image;
    viz::TransferableResource resource;
    bool has_alpha = false;
  };

  const DomicileSurfaceId id_;
  const raw_ptr<EngineEventQueue> queue_;

  mojo::Receiver<mojom::SurfaceObserver> observer_receiver_{this};
  mojo::Remote<viz::mojom::CompositorFrameSink> sink_;
  mojo::Receiver<viz::mojom::CompositorFrameSinkClient> client_receiver_{this};

  // A box the page embedded this surface at.
  struct Box {
    uint64_t number = 0;
    viz::LocalSurfaceId local_surface_id;
    gfx::Size size;
  };

  viz::FrameSinkId frame_sink_id_;
  // The box shown last, then every newer one, oldest first.
  base::circular_deque<Box> boxes_;
  uint64_t last_box_ = 0;
  // The synced frame submits go up at.
  uint32_t frame_ = 0;
  base::flat_map<uint64_t, Adopted> buffers_;
  base::flat_map<viz::ResourceId, uint64_t> resource_to_buffer_;
  viz::ResourceId next_resource_id_{1};
  viz::FrameTokenGenerator next_frame_token_;
  SurfaceFrames frames_;
  SurfaceSubmits submits_;
};

// The planes DomicileCapturedFrame carries.
constexpr size_t kMostCapturedPlanes =
    std::extent_v<decltype(DomicileCapturedFrame::planes)>;

// Asks the broker to start a capture through the pipes it is given, and
// replies whether it started.
using AskToCapture =
    base::OnceCallback<void(mojom::FrameSinkBroker*,
                            mojo::PendingReceiver<mojom::DisplayCapture>,
                            mojo::PendingRemote<mojom::DisplayCaptureObserver>,
                            base::OnceCallback<void(bool)>)>;

// One capture, of a display for a screen cast or of a browser window for a
// screenshot.
//
// Runs on the engine's mojo thread, like Surface, and reports to the
// compositor only through the EngineEventQueue. Holds each frame until the
// compositor releases it, which gives the buffer back to viz.
class Capture : public mojom::DisplayCaptureObserver {
 public:
  // `ended` runs once the browser closes the capture; the owner then
  // destroys this.
  Capture(DomicileCaptureId id, EngineEventQueue* queue, base::OnceClosure ended)
      : id_(id), queue_(queue), ended_(std::move(ended)) {}

  Capture(const Capture&) = delete;
  Capture& operator=(const Capture&) = delete;

  ~Capture() override = default;

  void Start(mojom::FrameSinkBroker* broker,
             AskToCapture ask,
             base::OnceCallback<void(bool)> done) {
    std::move(ask).Run(broker, control_.BindNewPipeAndPassReceiver(),
                       observer_.BindNewPipeAndPassRemote(), std::move(done));
  }

  // Starts hearing the browser close the capture. Called only once it
  // started, so a refusal's closed pipes are not an ending.
  void Watch() {
    if (!control_.is_connected()) {
      End();
      return;
    }
    // Unretained: both pipes are members.
    control_.set_disconnect_handler(
        base::BindOnce(&Capture::End, base::Unretained(this)));
    observer_.set_disconnect_handler(
        base::BindOnce(&Capture::End, base::Unretained(this)));
  }

  void Resize(const gfx::Size& size) { control_->Resize(size); }

  void Release(uint64_t frame) { holds_.erase(frame); }

 private:
  // mojom::DisplayCaptureObserver implementation.
  void OnFrameCaptured(
      mojom::CapturedFramePtr frame,
      mojo::PendingRemote<mojom::CapturedFrameHold> hold) override {
    EngineEvent event{.type = EngineEvent::Type::kCaptured,
                      .capture = id_,
                      .frame = next_frame_++};
    EngineCapturedFrame& out = event.captured;
    std::vector<base::ScopedFD> fds;
    if (frame->pixels->is_dmabuf()) {
      gfx::GpuMemoryBufferHandle& handle = frame->pixels->get_dmabuf();
      if (handle.type != gfx::NATIVE_PIXMAP) {
        // Closing `hold` gives the buffer back.
        LOG(ERROR) << "domicile: a captured frame came as a buffer that is "
                      "not a dmabuf; dropped";
        return;
      }
      gfx::NativePixmapHandle pixmap = std::move(handle).native_pixmap_handle();
      if (pixmap.planes.size() > kMostCapturedPlanes) {
        LOG(ERROR) << "domicile: a captured frame has " << pixmap.planes.size()
                   << " planes, more than the ABI carries; dropped";
        return;
      }
      out.memory = DOMICILE_CAPTURE_DMABUF;
      out.modifier = pixmap.modifier;
      for (gfx::NativePixmapPlane& plane : pixmap.planes) {
        out.planes.push_back({.offset = static_cast<uint32_t>(plane.offset),
                              .stride = plane.stride});
        fds.push_back(std::move(plane.fd));
      }
    } else {
      base::subtle::PlatformSharedMemoryRegion region =
          base::ReadOnlySharedMemoryRegion::TakeHandleForSerialization(
              std::move(frame->pixels->get_shm()));
      out.memory = DOMICILE_CAPTURE_SHM;
      out.planes.push_back({.offset = 0, .stride = frame->stride});
      fds.push_back(std::move(region.PassPlatformHandle().fd));
    }
    out.width = static_cast<uint32_t>(frame->size.width());
    out.height = static_cast<uint32_t>(frame->size.height());
    out.fourcc = frame->fourcc;
    out.fds =
        std::make_shared<const std::vector<base::ScopedFD>>(std::move(fds));
    out.content_x = frame->content.x();
    out.content_y = frame->content.y();
    out.content_width = frame->content.width();
    out.content_height = frame->content.height();
    out.damage_x = frame->damage.x();
    out.damage_y = frame->damage.y();
    out.damage_width = frame->damage.width();
    out.damage_height = frame->damage.height();
    holds_[event.frame] = mojo::Remote<mojom::CapturedFrameHold>(std::move(hold));
    queue_->Push(event);
  }

  // The browser closed the capture.
  void End() {
    queue_->Push(
        {.type = EngineEvent::Type::kCaptureEnded, .capture = id_});
    // Runs last: the owner destroys this.
    std::move(ended_).Run();
  }

  const DomicileCaptureId id_;
  const raw_ptr<EngineEventQueue> queue_;
  base::OnceClosure ended_;
  mojo::Remote<mojom::DisplayCapture> control_;
  mojo::Receiver<mojom::DisplayCaptureObserver> observer_{this};
  // The frames the compositor has not released, by frame id.
  base::flat_map<uint64_t, mojo::Remote<mojom::CapturedFrameHold>> holds_;
  uint64_t next_frame_ = 1;
};

// Forwards the browser's display list to the compositor.
//
// Separate from Surface because displays must be advertised before any window
// exists.
class Displays : public mojom::DisplayListObserver {
 public:
  explicit Displays(EngineEventQueue* queue) : queue_(queue) {}

  Displays(const Displays&) = delete;
  Displays& operator=(const Displays&) = delete;

  ~Displays() override = default;

  mojo::PendingRemote<mojom::DisplayListObserver> BindRemote() {
    return receiver_.BindNewPipeAndPassRemote();
  }

  // Mojo receivers must be reset on the thread that bound them.
  void Unbind() { receiver_.reset(); }

  // mojom::DisplayListObserver implementation.
  void OnDisplaysChanged(std::vector<mojom::DisplayPtr> displays) override {
    EngineEvent event{.type = EngineEvent::Type::kDisplays};
    event.displays.reserve(displays.size());
    for (const mojom::DisplayPtr& one : displays) {
      event.displays.push_back(
          EngineDisplay{.id = one->id,
                        .name = one->name,
                        .x = one->bounds.x(),
                        .y = one->bounds.y(),
                        .width = one->bounds.width(),
                        .height = one->bounds.height(),
                        .physical_width_mm = one->physical_size_mm.width(),
                        .physical_height_mm = one->physical_size_mm.height(),
                        .refresh_mhz = one->refresh_mhz,
                        .connector = one->connector});
    }
    queue_->Push(event);
  }

 private:
  const raw_ptr<EngineEventQueue> queue_;
  mojo::Receiver<mojom::DisplayListObserver> receiver_{this};
};

// Forwards the browser's copies to the compositor.
//
// Separate from Surface because a copy can happen before any window exists.
class Copies : public mojom::ClipboardObserver {
 public:
  explicit Copies(EngineEventQueue* queue) : queue_(queue) {}

  Copies(const Copies&) = delete;
  Copies& operator=(const Copies&) = delete;

  ~Copies() override = default;

  mojo::PendingRemote<mojom::ClipboardObserver> BindRemote() {
    return receiver_.BindNewPipeAndPassRemote();
  }

  // Reset on the binding thread, like Displays::Unbind.
  void Unbind() { receiver_.reset(); }

  // mojom::ClipboardObserver implementation.
  void OnCopied(
      mojom::Clipboard clipboard,
      const base::flat_map<std::string, std::vector<uint8_t>>& contents)
      override {
    EngineEvent event{.type = EngineEvent::Type::kCopied};
    event.clipboard = clipboard == mojom::Clipboard::kPrimary
                          ? DOMICILE_CLIPBOARD_PRIMARY
                          : DOMICILE_CLIPBOARD_COPY;
    event.copied = contents;
    queue_->Push(event);
  }

 private:
  const raw_ptr<EngineEventQueue> queue_;
  mojo::Receiver<mojom::ClipboardObserver> receiver_{this};
};

// Converts a client's dmabuf for mojo. Duplicates the fds; the caller keeps
// the originals.
gfx::GpuMemoryBufferHandle ToGpuMemoryBufferHandle(
    const DomicileDmabuf& dmabuf) {
  gfx::NativePixmapHandle pixmap;
  pixmap.modifier = dmabuf.modifier;
  // A span because -Wunsafe-buffer-usage rejects indexing a raw C array.
  const auto planes = base::span(dmabuf.planes);
  const uint32_t count = std::min<uint32_t>(dmabuf.plane_count, planes.size());
  for (uint32_t i = 0; i < count; ++i) {
    const DomicileDmabufPlane& plane = planes[i];
    base::ScopedFD duplicated(HANDLE_EINTR(dup(plane.fd)));
    if (!duplicated.is_valid()) {
      PLOG(ERROR) << "domicile: could not dup a dmabuf fd";
      return gfx::GpuMemoryBufferHandle();
    }
    pixmap.planes.emplace_back(plane.stride, plane.offset, /*size=*/0,
                               std::move(duplicated));
  }
  return gfx::GpuMemoryBufferHandle(std::move(pixmap));
}

// Converts a window's shared memory for mojo. Duplicates the fd; the caller
// keeps the original. Null, logged, if the fd cannot back it.
gfx::GpuMemoryBufferHandle ToGpuMemoryBufferHandle(
    const DomicileShmBuffer& buffer) {
  // Four bytes a pixel: every format the ABI names.
  if (buffer.width == 0 || buffer.height == 0 ||
      buffer.stride / 4 < buffer.width) {
    LOG(ERROR) << "domicile: " << buffer.width << "x" << buffer.height
               << " pixels do not fit rows " << buffer.stride << " bytes apart";
    return gfx::GpuMemoryBufferHandle();
  }
  const size_t size = static_cast<size_t>(buffer.stride) * buffer.height;
  // Viz reading past the end of the file would take a SIGBUS.
  struct stat file;
  if (fstat(buffer.fd, &file) != 0 ||
      static_cast<size_t>(file.st_size) < size) {
    PLOG(ERROR) << "domicile: a window's shared memory is smaller than the "
                << size << " bytes its frame needs";
    return gfx::GpuMemoryBufferHandle();
  }
  base::ScopedFD duplicated(HANDLE_EINTR(dup(buffer.fd)));
  if (!duplicated.is_valid()) {
    PLOG(ERROR) << "domicile: could not dup a window's shared memory fd";
    return gfx::GpuMemoryBufferHandle();
  }
  base::UnsafeSharedMemoryRegion region =
      base::UnsafeSharedMemoryRegion::Deserialize(
          base::subtle::PlatformSharedMemoryRegion::Take(
              std::move(duplicated),
              base::subtle::PlatformSharedMemoryRegion::Mode::kUnsafe, size,
              base::UnguessableToken::Create()));
  if (!region.IsValid()) {
    LOG(ERROR) << "domicile: a window's shared memory fd is not open for "
                  "reading and writing";
    return gfx::GpuMemoryBufferHandle();
  }
  gfx::GpuMemoryBufferHandle handle(std::move(region));
  handle.offset = 0;
  handle.stride = buffer.stride;
  return handle;
}

// Converts the C ABI's transform to the mojom enum.
//
// An undefined value means the compositor broke the ABI, so crash rather than
// draw a wrong rotation.
mojom::DisplayTransform TransformOf(DomicileDisplayTransform transform) {
  switch (transform) {
    case DOMICILE_DISPLAY_TRANSFORM_NORMAL:
      return mojom::DisplayTransform::kNormal;
    case DOMICILE_DISPLAY_TRANSFORM_ROTATE_90:
      return mojom::DisplayTransform::kRotate90;
    case DOMICILE_DISPLAY_TRANSFORM_ROTATE_180:
      return mojom::DisplayTransform::kRotate180;
    case DOMICILE_DISPLAY_TRANSFORM_ROTATE_270:
      return mojom::DisplayTransform::kRotate270;
  }
  NOTREACHED() << "domicile: no display transform numbered " << transform;
}

// The submit the C ABI's arguments describe. The caller has checked
// `transform`.
SurfaceSubmit SubmitOf(DomicileBufferId buffer,
                       int32_t crop_x,
                       int32_t crop_y,
                       int32_t crop_width,
                       int32_t crop_height,
                       int32_t damage_x,
                       int32_t damage_y,
                       int32_t damage_width,
                       int32_t damage_height,
                       uint64_t box,
                       DomicileBufferTransform transform) {
  SurfaceSubmit submit;
  submit.buffer = buffer;
  submit.crop = gfx::Rect(crop_x, crop_y, crop_width, crop_height);
  submit.damage = gfx::Rect(damage_x, damage_y, damage_width, damage_height);
  submit.box = box;
  submit.transform = static_cast<BufferTransform>(transform);
  return submit;
}

}  // namespace
}  // namespace domicile

// The engine. Outside the namespace because the C header forward-declares it
// as a global opaque struct.
struct DomicileEngine {
 public:
  explicit DomicileEngine(DomicileEngineCallbacks callbacks)
      : callbacks_(callbacks), thread_("domicile-engine") {}

  DomicileEngine(const DomicileEngine&) = delete;
  DomicileEngine& operator=(const DomicileEngine&) = delete;

  ~DomicileEngine() {
    if (thread_.IsRunning()) {
      // The mojo objects must be destroyed on the thread that created them.
      RunOnThreadAndWait(base::BindOnce(&DomicileEngine::TearDown,
                                        base::Unretained(this)));
      thread_.Stop();
    }
  }

  bool Connect(const std::string& socket_path) {
    base::Thread::Options options(base::MessagePumpType::IO, 0);
    if (!thread_.StartWithOptions(std::move(options))) {
      LOG(ERROR) << "domicile: could not start the engine thread";
      return false;
    }
    ipc_support_ = std::make_unique<mojo::core::ScopedIPCSupport>(
        thread_.task_runner(),
        mojo::core::ScopedIPCSupport::ShutdownPolicy::CLEAN);

    bool connected = false;
    RunOnThreadAndWait(base::BindOnce(&DomicileEngine::ConnectOnThread,
                                      base::Unretained(this), socket_path,
                                      &connected));
    return connected;
  }

  int fd() { return queue_.fd(); }

  // Runs on the caller's thread.
  //
  // DISABLE_CFI_ICALL because the callbacks are Rust functions, which CFI in
  // official builds rejects as indirect call targets and traps on. Keep every
  // call into the compositor in this function; see
  // scripts/test-a-callback-into-the-compositor-is-not-a-cfi-trap.sh.
  DISABLE_CFI_ICALL void Dispatch() {
    for (const domicile::EngineEvent& event : queue_.Drain()) {
      switch (event.type) {
        case domicile::EngineEvent::Type::kConfigure:
          if (callbacks_.configure_box) {
            callbacks_.configure_box(callbacks_.user_data, event.surface,
                                     event.width, event.height, event.scale,
                                     event.box);
          } else if (callbacks_.configure_at) {
            callbacks_.configure_at(callbacks_.user_data, event.surface,
                                    event.width, event.height, event.scale);
          } else if (callbacks_.configure) {
            callbacks_.configure(callbacks_.user_data, event.surface,
                                 event.width, event.height);
          }
          break;
        case domicile::EngineEvent::Type::kReleased:
          if (callbacks_.released) {
            callbacks_.released(callbacks_.user_data, event.surface,
                                event.buffer);
          }
          break;
        case domicile::EngineEvent::Type::kDisplays:
          // Convert to the ABI's records, whose strings are `const char*`.
          // The strings belong to `event`, which lives in the drained vector
          // until the loop ends, so they outlive the callback as the header
          // promises.
          if (callbacks_.connected_displays) {
            std::vector<DomicileConnectedDisplay> records;
            records.reserve(event.displays.size());
            for (const domicile::EngineDisplay& display : event.displays) {
              records.push_back(DomicileConnectedDisplay{
                  .display = RecordOf(display),
                  .connector = display.connector.c_str()});
            }
            callbacks_.connected_displays(
                callbacks_.user_data, records.data(),
                static_cast<uint32_t>(records.size()));
          } else if (callbacks_.displays) {
            std::vector<DomicileDisplay> records;
            records.reserve(event.displays.size());
            for (const domicile::EngineDisplay& display : event.displays) {
              records.push_back(RecordOf(display));
            }
            callbacks_.displays(callbacks_.user_data, records.data(),
                                static_cast<uint32_t>(records.size()));
          }
          break;
        case domicile::EngineEvent::Type::kCopied:
          // `event` owns the bytes until the loop ends, as for display names.
          if (callbacks_.copied_items) {
            std::vector<DomicileClipboardItem> items;
            items.reserve(event.copied.size());
            for (const auto& [mime_type, data] : event.copied) {
              items.push_back(
                  DomicileClipboardItem{.mime_type = mime_type.c_str(),
                                        .data = data.data(),
                                        .length = data.size()});
            }
            callbacks_.copied_items(callbacks_.user_data, event.clipboard,
                                    items.data(),
                                    static_cast<uint32_t>(items.size()));
          } else if (callbacks_.copied) {
            auto text = event.copied.find(domicile::kClipboardText);
            const std::string copied =
                text == event.copied.end()
                    ? std::string()
                    : std::string(text->second.begin(), text->second.end());
            callbacks_.copied(callbacks_.user_data, event.clipboard,
                              copied.data(), copied.size());
          }
          break;
        case domicile::EngineEvent::Type::kCaptured:
          if (callbacks_.captured) {
            // `event` owns the fds until the loop ends, as for display names.
            const DomicileCapturedFrame record = RecordOf(event.captured);
            callbacks_.captured(callbacks_.user_data, event.capture,
                                event.frame, &record);
          }
          break;
        case domicile::EngineEvent::Type::kCaptureEnded:
          if (callbacks_.capture_ended) {
            callbacks_.capture_ended(callbacks_.user_data, event.capture);
          }
          break;
        case domicile::EngineEvent::Type::kFrameDone:
          if (callbacks_.frame_done) {
            callbacks_.frame_done(callbacks_.user_data, event.surface,
                                  event.frame);
          }
          break;
        case domicile::EngineEvent::Type::kPresented:
          if (callbacks_.presented) {
            callbacks_.presented(callbacks_.user_data, event.surface,
                                 event.frame, event.time_ns, event.refresh_ns,
                                 event.flags);
          }
          break;
        case domicile::EngineEvent::Type::kImported:
          if (callbacks_.imported) {
            callbacks_.imported(callbacks_.user_data, event.surface,
                                event.request, event.buffer);
          }
          break;
        case domicile::EngineEvent::Type::kDisconnected:
          if (callbacks_.disconnected) {
            callbacks_.disconnected(callbacks_.user_data);
          }
          break;
      }
    }
  }

  DomicileSurfaceId CreateSurface(const std::string& app_id) {
    DomicileSurfaceId created = 0;
    RunOnThreadAndWait(base::BindOnce(&DomicileEngine::CreateSurfaceOnThread,
                                      base::Unretained(this), app_id,
                                      &created));
    return created;
  }

  void DestroySurface(DomicileSurfaceId surface) {
    RunOnThreadAndWait(base::BindOnce(&DomicileEngine::DestroySurfaceOnThread,
                                      base::Unretained(this), surface));
  }

  // Blocks; runs once per buffer, not per frame. A null `handle` is refused.
  DomicileBufferId ImportBuffer(DomicileSurfaceId surface,
                                gfx::GpuMemoryBufferHandle handle,
                                const gfx::Size& size,
                                uint32_t fourcc) {
    DomicileBufferId imported = 0;
    RunOnThreadAndWait(base::BindOnce(
        &DomicileEngine::ImportBufferOnThread, base::Unretained(this), surface,
        std::move(handle), size, fourcc, &imported));
    return imported;
  }

  // Returns at once; the answer arrives as kImported. Duplicates the fds
  // here, since the ABI lends them only for the call.
  void ImportBufferAsync(DomicileSurfaceId surface,
                         const DomicileDmabuf& dmabuf,
                         uint64_t request) {
    thread_.task_runner()->PostTask(
        FROM_HERE,
        base::BindOnce(&DomicileEngine::ImportBufferAsyncOnThread,
                       base::Unretained(this), surface,
                       domicile::ToGpuMemoryBufferHandle(dmabuf),
                       gfx::Size(static_cast<int>(dmabuf.width),
                                 static_cast<int>(dmabuf.height)),
                       dmabuf.fourcc, request));
  }

  void SubmitBuffer(DomicileSurfaceId surface,
                    const domicile::SurfaceSubmit& submit) {
    thread_.task_runner()->PostTask(
        FROM_HERE, base::BindOnce(&DomicileEngine::SubmitBufferOnThread,
                                  base::Unretained(this), surface, submit));
  }

  // Duplicates `acquire_fence` here, since the ABI lends it only for the call.
  void SubmitFencedBuffer(DomicileSurfaceId surface,
                          const domicile::SurfaceSubmit& submit,
                          int acquire_fence) {
    base::ScopedFD fence(HANDLE_EINTR(dup(acquire_fence)));
    PCHECK(fence.is_valid()) << "domicile: the acquire fence is not an fd";
    thread_.task_runner()->PostTask(
        FROM_HERE,
        base::BindOnce(&DomicileEngine::SubmitFencedBufferOnThread,
                       base::Unretained(this), surface, submit,
                       std::move(fence)));
  }

  // Posted like the submits, so it applies between the ones around it.
  void SyncSurface(DomicileSurfaceId surface, uint32_t frame) {
    thread_.task_runner()->PostTask(
        FROM_HERE, base::BindOnce(&DomicileEngine::SyncSurfaceOnThread,
                                  base::Unretained(this), surface, frame));
  }

  // Throwaway; see domicile_engine_spike.h.
  bool SampleWindowCenter(uint32_t* argb) {
    bool sampled = false;
    RunOnThreadAndWait(base::BindOnce(
        &DomicileEngine::SampleWindowCenterOnThread, base::Unretained(this),
        &sampled, argb));
    return sampled;
  }

  // Throwaway; see domicile_engine_spike.h.
  bool SamplePixel(int32_t x, int32_t y, uint32_t* argb) {
    bool sampled = false;
    RunOnThreadAndWait(base::BindOnce(&DomicileEngine::SamplePixelOnThread,
                                      base::Unretained(this), x, y, &sampled,
                                      argb));
    return sampled;
  }

  // Throwaway; see domicile_engine_spike.h.
  int32_t FindColor(uint32_t argb, DomicileSpikeCapture* out) {
    int32_t found = -1;
    RunOnThreadAndWait(base::BindOnce(&DomicileEngine::FindColorOnThread,
                                      base::Unretained(this), argb, &found,
                                      out));
    return found;
  }

  void DestroyBuffer(DomicileSurfaceId surface, DomicileBufferId buffer) {
    thread_.task_runner()->PostTask(
        FROM_HERE,
        base::BindOnce(&DomicileEngine::DestroyBufferOnThread,
                       base::Unretained(this), surface, buffer));
  }

  // Copies the records before posting: the ABI borrows them only for the call,
  // which returns before the mojo thread runs.
  void ConfigureDisplays(const DomicileDisplayLayout* layout, uint32_t count) {
    // Fully qualified because `DomicileEngine` is outside `namespace domicile`.
    std::vector<domicile::mojom::DisplayLayoutPtr> wanted;
    wanted.reserve(count);
    // SAFETY: the ABI says `layout` points at `count` records valid for this
    // call, and `domicile_displays_configure` has refused a null pointer with a
    // nonzero count. Chromium builds with `-Wunsafe-buffer-usage`, and a span
    // over an ABI pointer and length requires `UNSAFE_BUFFERS`.
    const auto records =
        UNSAFE_BUFFERS(base::span(layout, static_cast<size_t>(count)));
    for (const DomicileDisplayLayout& display : records) {
      wanted.push_back(domicile::mojom::DisplayLayout::New(
          display.id, display.enabled != 0, gfx::Point(display.x, display.y),
          domicile::TransformOf(display.transform), display.scale,
          gfx::Rect(display.desk_x, display.desk_y, display.desk_width,
                    display.desk_height)));
    }
    thread_.task_runner()->PostTask(
        FROM_HERE,
        base::BindOnce(&DomicileEngine::ConfigureDisplaysOnThread,
                       base::Unretained(this), std::move(wanted)));
  }

  // Copies the records before posting, as ConfigureDisplays does.
  void ConfigurePointers(const DomicilePointerTarget* targets, uint32_t count) {
    std::vector<domicile::mojom::PointerTargetPtr> wanted;
    wanted.reserve(count);
    // SAFETY: the ABI says `targets` points at `count` records valid for this
    // call, and `domicile_pointers_configure` has refused a null pointer with
    // a nonzero count.
    const auto records =
        UNSAFE_BUFFERS(base::span(targets, static_cast<size_t>(count)));
    for (const DomicilePointerTarget& target : records) {
      CHECK(target.device) << "domicile: a pointer target names no device";
      wanted.push_back(domicile::mojom::PointerTarget::New(target.device,
                                                           target.display_id));
    }
    thread_.task_runner()->PostTask(
        FROM_HERE,
        base::BindOnce(&DomicileEngine::ConfigurePointersOnThread,
                       base::Unretained(this), std::move(wanted)));
  }

  // Copies the records before posting, as ConfigureDisplays does.
  void ConfigureVirtualDisplays(const DomicileVirtualDisplay* displays,
                                uint32_t count) {
    std::vector<domicile::mojom::VirtualDisplayPtr> wanted;
    wanted.reserve(count);
    // SAFETY: the ABI says `displays` points at `count` records valid for this
    // call, and `domicile_virtual_displays_configure` has refused a null
    // pointer with a nonzero count.
    const auto records =
        UNSAFE_BUFFERS(base::span(displays, static_cast<size_t>(count)));
    for (const DomicileVirtualDisplay& display : records) {
      CHECK(display.name) << "domicile: a virtual display has no name";
      wanted.push_back(domicile::mojom::VirtualDisplay::New(
          display.id, gfx::Size(display.width, display.height),
          display.refresh_mhz, display.name));
    }
    thread_.task_runner()->PostTask(
        FROM_HERE,
        base::BindOnce(&DomicileEngine::ConfigureVirtualDisplaysOnThread,
                       base::Unretained(this), std::move(wanted)));
  }

  // Blocks for the browser's answer, like CreateSurface.
  DomicileCaptureId StartCapture(int64_t display_id,
                                 const gfx::Size& size,
                                 uint32_t max_fps) {
    return StartCaptureWith(base::BindOnce(
        [](int64_t display_id, const gfx::Size& size, uint32_t max_fps,
           domicile::mojom::FrameSinkBroker* broker,
           mojo::PendingReceiver<domicile::mojom::DisplayCapture> capture,
           mojo::PendingRemote<domicile::mojom::DisplayCaptureObserver>
               observer,
           base::OnceCallback<void(bool)> done) {
          broker->CaptureDisplay(display_id, size, max_fps, std::move(capture),
                                 std::move(observer), std::move(done));
        },
        display_id, size, max_fps));
  }

  // Blocks for the browser's answer, like StartCapture.
  DomicileCaptureId StartBrowserWindowCapture(const std::string& window_id,
                                              uint32_t max_fps) {
    return StartCaptureWith(base::BindOnce(
        [](const std::string& window_id, uint32_t max_fps,
           domicile::mojom::FrameSinkBroker* broker,
           mojo::PendingReceiver<domicile::mojom::DisplayCapture> capture,
           mojo::PendingRemote<domicile::mojom::DisplayCaptureObserver>
               observer,
           base::OnceCallback<void(bool)> done) {
          broker->CaptureBrowserWindow(window_id, max_fps, std::move(capture),
                                       std::move(observer), std::move(done));
        },
        window_id, max_fps));
  }

  void ResizeCapture(DomicileCaptureId capture, const gfx::Size& size) {
    thread_.task_runner()->PostTask(
        FROM_HERE, base::BindOnce(&DomicileEngine::ResizeCaptureOnThread,
                                  base::Unretained(this), capture, size));
  }

  void StopCapture(DomicileCaptureId capture) {
    thread_.task_runner()->PostTask(
        FROM_HERE, base::BindOnce(&DomicileEngine::ForgetCapture,
                                  base::Unretained(this), capture));
  }

  void ReleaseCapturedFrame(DomicileCaptureId capture, uint64_t frame) {
    thread_.task_runner()->PostTask(
        FROM_HERE, base::BindOnce(&DomicileEngine::ReleaseCapturedFrameOnThread,
                                  base::Unretained(this), capture, frame));
  }

  // Takes a copy: the ABI lends the bytes only for the call, and the browser is
  // told later on another thread.
  void SetClipboard(
      DomicileClipboard clipboard,
      base::flat_map<std::string, std::vector<uint8_t>> contents) {
    thread_.task_runner()->PostTask(
        FROM_HERE, base::BindOnce(&DomicileEngine::SetClipboardOnThread,
                                  base::Unretained(this), clipboard,
                                  std::move(contents)));
  }

 private:
  // The ABI's record of `display`, pointing at the name `display` owns.
  static DomicileDisplay RecordOf(const domicile::EngineDisplay& display) {
    return DomicileDisplay{.id = display.id,
                           .name = display.name.c_str(),
                           .x = display.x,
                           .y = display.y,
                           .width = display.width,
                           .height = display.height,
                           .physical_width_mm = display.physical_width_mm,
                           .physical_height_mm = display.physical_height_mm,
                           .refresh_mhz = display.refresh_mhz};
  }

  // The ABI's record of `frame`, pointing at the fds `frame` owns.
  static DomicileCapturedFrame RecordOf(
      const domicile::EngineCapturedFrame& frame) {
    DomicileCapturedFrame record = {
        .memory = frame.memory,
        .width = frame.width,
        .height = frame.height,
        .fourcc = frame.fourcc,
        .modifier = frame.modifier,
        .plane_count = static_cast<uint32_t>(frame.planes.size()),
        .planes = {},
        .content_x = frame.content_x,
        .content_y = frame.content_y,
        .content_width = frame.content_width,
        .content_height = frame.content_height,
        .damage_x = frame.damage_x,
        .damage_y = frame.damage_y,
        .damage_width = frame.damage_width,
        .damage_height = frame.damage_height};
    // A span because -Wunsafe-buffer-usage rejects indexing a raw C array.
    // Capture::OnFrameCaptured refused more planes than it holds.
    const auto planes = base::span(record.planes);
    for (size_t i = 0; i < frame.planes.size(); ++i) {
      planes[i] = {.fd = (*frame.fds)[i].get(),
                   .offset = frame.planes[i].offset,
                   .stride = frame.planes[i].stride};
    }
    return record;
  }

  DomicileCaptureId StartCaptureWith(domicile::AskToCapture ask) {
    DomicileCaptureId started = 0;
    RunOnThreadAndWait(base::BindOnce(&DomicileEngine::StartCaptureOnThread,
                                      base::Unretained(this), std::move(ask),
                                      &started));
    return started;
  }

  void StartCaptureOnThread(domicile::AskToCapture ask,
                            DomicileCaptureId* started) {
    if (!broker_) {
      return;
    }
    const DomicileCaptureId id = next_capture_id_++;
    auto capture = std::make_unique<domicile::Capture>(
        id, &queue_,
        base::BindOnce(&DomicileEngine::ForgetCapture, base::Unretained(this),
                       id));
    domicile::Capture* raw = capture.get();
    captures_[id] = std::move(capture);

    // Synchronous because the ABI is; see CreateSurfaceOnThread.
    base::RunLoop loop(base::RunLoop::Type::kNestableTasksAllowed);
    bool ok = false;
    raw->Start(broker_.get(), std::move(ask),
               base::BindOnce(
                   [](base::RunLoop* loop, bool* ok, bool result) {
                     *ok = result;
                     loop->Quit();
                   },
                   &loop, &ok));
    loop.Run();
    if (!ok) {
      captures_.erase(id);
      return;
    }
    *started = id;
    raw->Watch();
  }

  void ResizeCaptureOnThread(DomicileCaptureId capture, const gfx::Size& size) {
    auto iter = captures_.find(capture);
    if (iter != captures_.end()) {
      iter->second->Resize(size);
    }
  }

  void ReleaseCapturedFrameOnThread(DomicileCaptureId capture,
                                    uint64_t frame) {
    auto iter = captures_.find(capture);
    if (iter != captures_.end()) {
      iter->second->Release(frame);
    }
  }

  // Closing the capture's pipes stops it in the browser and releases its
  // frames.
  void ForgetCapture(DomicileCaptureId capture) { captures_.erase(capture); }

  void SetClipboardOnThread(
      DomicileClipboard clipboard,
      base::flat_map<std::string, std::vector<uint8_t>> contents) {
    if (broker_) {
      broker_->SetClipboard(clipboard == DOMICILE_CLIPBOARD_PRIMARY
                                ? domicile::mojom::Clipboard::kPrimary
                                : domicile::mojom::Clipboard::kCopy,
                            std::move(contents));
    }
  }

  void ConfigureDisplaysOnThread(
      std::vector<domicile::mojom::DisplayLayoutPtr> wanted) {
    if (broker_) {
      broker_->ConfigureDisplays(std::move(wanted));
    }
  }

  void ConfigurePointersOnThread(
      std::vector<domicile::mojom::PointerTargetPtr> wanted) {
    if (broker_) {
      broker_->ConfigurePointers(std::move(wanted));
    }
  }

  void ConfigureVirtualDisplaysOnThread(
      std::vector<domicile::mojom::VirtualDisplayPtr> wanted) {
    if (broker_) {
      broker_->ConfigureVirtualDisplays(std::move(wanted));
    }
  }

  void ConnectOnThread(const std::string& socket_path, bool* connected) {
    mojo::PlatformChannelEndpoint endpoint =
        mojo::NamedPlatformChannel::ConnectToServer(
            mojo::NamedPlatformChannel::ServerNameFromUTF8(socket_path));
    if (!endpoint.is_valid()) {
      LOG(ERROR) << "domicile: no browser listening at " << socket_path;
      *connected = false;
      return;
    }

    // A real invitation rather than a mojo::IsolatedConnection, because the
    // broker forwards our CompositorFrameSink receiver to the viz process, and
    // an isolated connection cannot carry it there. See
    // ENGINE-FORK.md#how-the-producer-reaches-the-broker.
    mojo::IncomingInvitation invitation =
        mojo::IncomingInvitation::Accept(std::move(endpoint));
    if (!invitation.is_valid()) {
      LOG(ERROR) << "domicile: the browser refused the invitation";
      *connected = false;
      return;
    }

    broker_.Bind(mojo::PendingRemote<domicile::mojom::FrameSinkBroker>(
        invitation.ExtractMessagePipe(domicile::kBrokerPipeName), 0));
    probe_.Bind(mojo::PendingRemote<domicile::mojom::SpikeProbe>(
        invitation.ExtractMessagePipe(domicile::kProbePipeName), 0));
    if (broker_.is_bound()) {
      // Said rather than left to the next hello's pid, which a reused pid or a
      // missing credential gets wrong. Unretained: `this` owns `broker_`.
      broker_.set_disconnect_handler(base::BindOnce(
          [](domicile::EngineEventQueue* queue) {
            queue->Push({.type = domicile::EngineEvent::Type::kDisconnected});
          },
          base::Unretained(&queue_)));
      // Observe displays on connect, since a desktop needs its screens before
      // any window. The browser answers once it has read them.
      broker_->ObserveDisplays(displays_.BindRemote());
      // Observe the clipboard on connect too: a page can copy before any window
      // exists.
      broker_->ObserveClipboard(copies_.BindRemote());
    }
    *connected = broker_.is_bound();
  }

  void CreateSurfaceOnThread(const std::string& app_id,
                             DomicileSurfaceId* created) {
    if (!broker_) {
      return;
    }
    const DomicileSurfaceId id = next_surface_id_++;
    auto surface = std::make_unique<domicile::Surface>(id, &queue_);
    domicile::Surface* raw = surface.get();
    surfaces_[id] = std::move(surface);

    // Synchronous because the ABI is. Runs a nested loop because the reply
    // arrives on this thread; the caller waits in RunOnThreadAndWait.
    base::RunLoop loop(base::RunLoop::Type::kNestableTasksAllowed);
    bool ok = false;
    raw->Create(broker_.get(), app_id,
                base::BindOnce(
                    [](base::RunLoop* loop, bool* ok, bool result) {
                      *ok = result;
                      loop->Quit();
                    },
                    &loop, &ok));
    loop.Run();
    if (!ok) {
      surfaces_.erase(id);
      return;
    }
    *created = id;
  }

  // Tells the broker explicitly: closing our pipes does not reach it, so the
  // BrokeredFrameSink and its buffers would otherwise live as long as the
  // connection.
  void DestroySurfaceOnThread(DomicileSurfaceId surface) {
    auto iter = surfaces_.find(surface);
    if (iter == surfaces_.end()) {
      return;
    }
    if (broker_) {
      broker_->DestroyFrameSink(iter->second->frame_sink_id());
    }
    surfaces_.erase(iter);
  }

  void ImportBufferOnThread(DomicileSurfaceId surface,
                            gfx::GpuMemoryBufferHandle handle,
                            const gfx::Size& size,
                            uint32_t fourcc,
                            DomicileBufferId* imported) {
    auto iter = surfaces_.find(surface);
    if (iter == surfaces_.end() || !broker_ || handle.is_null()) {
      return;
    }

    base::RunLoop loop(base::RunLoop::Type::kNestableTasksAllowed);
    domicile::Surface* raw = iter->second.get();
    broker_->ImportBuffer(
        raw->frame_sink_id(), std::move(handle), size, fourcc,
        base::BindOnce(
            [](base::RunLoop* loop, DomicileBufferId* imported,
               domicile::Surface* surface, bool has_alpha, uint64_t id,
               std::optional<gpu::ExportedSharedImage> exported) {
              // Without the SharedImage there is nothing to submit, so treat
              // the import as refused.
              if (id != 0 && exported.has_value()) {
                surface->Adopt(id, std::move(exported).value(), has_alpha);
                *imported = id;
              }
              loop->Quit();
            },
            &loop, imported, raw, domicile::FourccHasAlpha(fourcc)));
    loop.Run();
  }

  // Unretained: the reply is dropped when TearDown resets `broker_`.
  void ImportBufferAsyncOnThread(DomicileSurfaceId surface,
                                 gfx::GpuMemoryBufferHandle handle,
                                 const gfx::Size& size,
                                 uint32_t fourcc,
                                 uint64_t request) {
    auto iter = surfaces_.find(surface);
    if (iter == surfaces_.end() || !broker_ || handle.is_null()) {
      OnImported(surface, request, /*has_alpha=*/false, 0, std::nullopt);
      return;
    }
    broker_->ImportBuffer(
        iter->second->frame_sink_id(), std::move(handle), size, fourcc,
        base::BindOnce(&DomicileEngine::OnImported, base::Unretained(this),
                       surface, request, domicile::FourccHasAlpha(fourcc)));
  }

  // The surface may have gone while the browser imported.
  void OnImported(DomicileSurfaceId surface,
                  uint64_t request,
                  bool has_alpha,
                  uint64_t id,
                  std::optional<gpu::ExportedSharedImage> exported) {
    DomicileBufferId imported = 0;
    auto iter = surfaces_.find(surface);
    // Without the SharedImage there is nothing to submit, so treat the import
    // as refused.
    if (iter != surfaces_.end() && id != 0 && exported.has_value()) {
      iter->second->Adopt(id, std::move(exported).value(), has_alpha);
      imported = id;
    }
    queue_.Push({.type = domicile::EngineEvent::Type::kImported,
                 .surface = surface,
                 .buffer = imported,
                 .request = request});
  }

  void SubmitBufferOnThread(DomicileSurfaceId surface,
                            const domicile::SurfaceSubmit& submit) {
    auto iter = surfaces_.find(surface);
    if (iter != surfaces_.end()) {
      iter->second->Submit(submit);
    }
  }

  void SyncSurfaceOnThread(DomicileSurfaceId surface, uint32_t frame) {
    auto iter = surfaces_.find(surface);
    if (iter != surfaces_.end()) {
      iter->second->Sync(frame);
    }
  }

  // Holds the submit until the browser has put the fence in place, so the
  // compositor need not wait for its draw.
  //
  // Unretained: the reply is dropped when TearDown resets `broker_`.
  void SubmitFencedBufferOnThread(DomicileSurfaceId surface,
                                  const domicile::SurfaceSubmit& submit,
                                  base::ScopedFD fence) {
    auto iter = surfaces_.find(surface);
    if (iter == surfaces_.end()) {
      return;
    }
    const uint64_t ticket = iter->second->Hold(submit);
    gfx::GpuFenceHandle handle;
    handle.Adopt(std::move(fence));
    broker_->FenceBuffer(
        iter->second->frame_sink_id(), submit.buffer, std::move(handle),
        base::BindOnce(&DomicileEngine::OnFenced, base::Unretained(this),
                       surface, ticket));
  }

  // The surface may have gone while the browser fenced.
  void OnFenced(DomicileSurfaceId surface,
                uint64_t ticket,
                const std::optional<gpu::SyncToken>& sync_token) {
    auto iter = surfaces_.find(surface);
    if (iter != surfaces_.end()) {
      iter->second->Fenced(ticket, sync_token);
    }
  }

  void SampleWindowCenterOnThread(bool* sampled, uint32_t* argb) {
    if (!probe_) {
      return;
    }
    const uint64_t request = ++probe_requests_;
    base::RunLoop loop(base::RunLoop::Type::kNestableTasksAllowed);
    probe_->SampleWindowCenter(
        base::BindOnce(
            [](base::RunLoop* loop, bool* sampled, uint32_t* argb, bool ok,
               uint32_t color) {
              *sampled = ok;
              *argb = color;
              loop->Quit();
            },
            &loop, sampled, argb));
    AwaitProbe(loop, "window center sample", request);
  }

  void SamplePixelOnThread(int32_t x,
                           int32_t y,
                           bool* sampled,
                           uint32_t* argb) {
    if (!probe_) {
      return;
    }
    const uint64_t request = ++probe_requests_;
    base::RunLoop loop(base::RunLoop::Type::kNestableTasksAllowed);
    probe_->SamplePixel(
        gfx::Point(x, y),
        base::BindOnce(
            [](base::RunLoop* loop, bool* sampled, uint32_t* argb, bool ok,
               uint32_t color) {
              *sampled = ok;
              *argb = color;
              loop->Quit();
            },
            &loop, sampled, argb));
    AwaitProbe(loop, "pixel sample", request);
  }

  void FindColorOnThread(uint32_t argb,
                         int32_t* found,
                         DomicileSpikeCapture* out) {
    if (!probe_) {
      return;
    }
    const uint64_t request = ++probe_requests_;
    base::RunLoop loop(base::RunLoop::Type::kNestableTasksAllowed);
    probe_->CaptureWindow(base::BindOnce(
        [](base::RunLoop* loop, uint32_t wanted, int32_t* found,
           DomicileSpikeCapture* out, bool captured, const gfx::Size& size,
           const std::vector<uint32_t>& pixels) {
          // SpikeProbe returns false for an empty bitmap, so `captured`
          // implies a non-empty one.
          if (captured) {
            out->window_width = size.width();
            out->window_height = size.height();
            *found = 0;

            // Bound by both `size` and the reply's length, so a short reply is
            // not overread and a long one adds no rows.
            const size_t width = static_cast<size_t>(size.width());
            const size_t area = width * static_cast<size_t>(size.height());
            const size_t last = std::min(area, pixels.size());

            // Compute the color's bounding box in one row-major pass.
            int32_t left = size.width();
            int32_t top = size.height();
            int32_t right = -1;
            int32_t bottom = -1;
            for (size_t i = 0; i < last; ++i) {
              if (pixels[i] != wanted) {
                continue;
              }
              const int32_t x = static_cast<int32_t>(i % width);
              const int32_t y = static_cast<int32_t>(i / width);
              left = std::min(left, x);
              right = std::max(right, x);
              top = std::min(top, y);
              bottom = std::max(bottom, y);
            }

            if (right >= 0) {
              *found = 1;
              out->x = left;
              out->y = top;
              out->width = right - left + 1;
              out->height = bottom - top + 1;
            }
          }
          loop->Quit();
        },
        &loop, argb, found, out));
    AwaitProbe(loop, "window capture", request);
  }

  // Waits in `loop` for the browser's answer to probe `request` number
  // `number`, which arrives on this thread. A capture viz never serves, or a
  // browser that is gone, would otherwise hold the caller forever.
  void AwaitProbe(base::RunLoop& loop,
                  std::string_view request,
                  uint64_t number) {
    if (!domicile::RunUntilQuit(loop, domicile::kProbePatience)) {
      LOG(FATAL) << domicile::NeverAnswered(request, number,
                                            domicile::kProbePatience);
    }
  }

  void DestroyBufferOnThread(DomicileSurfaceId surface,
                             DomicileBufferId buffer) {
    auto iter = surfaces_.find(surface);
    if (iter != surfaces_.end() && broker_) {
      iter->second->Forget(buffer);
      broker_->DestroyBuffer(iter->second->frame_sink_id(), buffer);
    }
  }

  void TearDown() {
    captures_.clear();
    surfaces_.clear();
    broker_.reset();
    // Mojo remotes and receivers check they are destroyed on the thread that
    // bound them.
    probe_.reset();
    displays_.Unbind();
    copies_.Unbind();
  }

  void RunOnThreadAndWait(base::OnceClosure task) {
    base::WaitableEvent done;
    thread_.task_runner()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](base::OnceClosure task, base::WaitableEvent* done) {
                         std::move(task).Run();
                         done->Signal();
                       },
                       std::move(task), &done));
    done.Wait();
  }

  const DomicileEngineCallbacks callbacks_;
  domicile::EngineEventQueue queue_;
  // Bound on the engine's thread in ConnectOnThread.
  domicile::Displays displays_{&queue_};
  domicile::Copies copies_{&queue_};
  base::Thread thread_;
  std::unique_ptr<mojo::core::ScopedIPCSupport> ipc_support_;
  mojo::Remote<domicile::mojom::FrameSinkBroker> broker_;
  // Throwaway; see domicile_engine_spike.h.
  mojo::Remote<domicile::mojom::SpikeProbe> probe_;
  // Counts probe requests, so a fatal log names the one never answered.
  uint64_t probe_requests_ = 0;
  base::flat_map<DomicileSurfaceId, std::unique_ptr<domicile::Surface>>
      surfaces_;
  DomicileSurfaceId next_surface_id_ = 1;
  base::flat_map<DomicileCaptureId, std::unique_ptr<domicile::Capture>>
      captures_;
  DomicileCaptureId next_capture_id_ = 1;
};

extern "C" {

DomicileEngine* domicile_engine_connect(const char* socket_path,
                                        DomicileEngineCallbacks callbacks) {
  if (!socket_path) {
    LOG(ERROR) << "domicile: domicile_engine_connect needs a socket path";
    return nullptr;
  }
  domicile::EnsureMojoInitialized();

  auto engine = std::make_unique<DomicileEngine>(callbacks);
  if (!engine->Connect(socket_path)) {
    return nullptr;
  }
  return engine.release();
}

void domicile_engine_destroy(DomicileEngine* engine) {
  delete engine;
}

int domicile_engine_reports_frames(void) {
  return 1;
}

int domicile_engine_fd(DomicileEngine* engine) {
  return engine ? engine->fd() : -1;
}

void domicile_engine_dispatch(DomicileEngine* engine) {
  if (engine) {
    engine->Dispatch();
  }
}

DomicileSurfaceId domicile_surface_create(DomicileEngine* engine,
                                          const char* app_id) {
  if (!engine) {
    return 0;
  }
  return engine->CreateSurface(app_id ? app_id : "");
}

void domicile_surface_destroy(DomicileEngine* engine,
                              DomicileSurfaceId surface) {
  if (engine) {
    engine->DestroySurface(surface);
  }
}

DomicileBufferId domicile_surface_import(DomicileEngine* engine,
                                         DomicileSurfaceId surface,
                                         const DomicileDmabuf* dmabuf) {
  if (!engine || !dmabuf) {
    return 0;
  }
  return engine->ImportBuffer(
      surface, domicile::ToGpuMemoryBufferHandle(*dmabuf),
      gfx::Size(static_cast<int>(dmabuf->width),
                static_cast<int>(dmabuf->height)),
      dmabuf->fourcc);
}

DomicileBufferId domicile_surface_import_shm(DomicileEngine* engine,
                                             DomicileSurfaceId surface,
                                             const DomicileShmBuffer* buffer) {
  CHECK(buffer);
  if (!engine) {
    return 0;
  }
  return engine->ImportBuffer(
      surface, domicile::ToGpuMemoryBufferHandle(*buffer),
      gfx::Size(static_cast<int>(buffer->width),
                static_cast<int>(buffer->height)),
      buffer->fourcc);
}

void domicile_surface_import_async(DomicileEngine* engine,
                                   DomicileSurfaceId surface,
                                   const DomicileDmabuf* dmabuf,
                                   uint64_t request) {
  CHECK(dmabuf);
  if (engine) {
    engine->ImportBufferAsync(surface, *dmabuf, request);
  }
}

void domicile_surface_submit(DomicileEngine* engine,
                             DomicileSurfaceId surface,
                             DomicileBufferId buffer,
                             int32_t damage_x,
                             int32_t damage_y,
                             int32_t damage_width,
                             int32_t damage_height) {
  domicile_surface_submit_crop(engine, surface, buffer, 0, 0, 0, 0, damage_x,
                               damage_y, damage_width, damage_height);
}

void domicile_surface_submit_crop(DomicileEngine* engine,
                                  DomicileSurfaceId surface,
                                  DomicileBufferId buffer,
                                  int32_t crop_x,
                                  int32_t crop_y,
                                  int32_t crop_width,
                                  int32_t crop_height,
                                  int32_t damage_x,
                                  int32_t damage_y,
                                  int32_t damage_width,
                                  int32_t damage_height) {
  domicile_surface_submit_for_box(engine, surface, buffer, crop_x, crop_y,
                                  crop_width, crop_height, damage_x, damage_y,
                                  damage_width, damage_height,
                                  DOMICILE_NEWEST_BOX);
}

void domicile_surface_submit_for_box(DomicileEngine* engine,
                                     DomicileSurfaceId surface,
                                     DomicileBufferId buffer,
                                     int32_t crop_x,
                                     int32_t crop_y,
                                     int32_t crop_width,
                                     int32_t crop_height,
                                     int32_t damage_x,
                                     int32_t damage_y,
                                     int32_t damage_width,
                                     int32_t damage_height,
                                     uint64_t box) {
  domicile_surface_submit_transformed(
      engine, surface, buffer, crop_x, crop_y, crop_width, crop_height,
      damage_x, damage_y, damage_width, damage_height, box,
      DOMICILE_BUFFER_TRANSFORM_NORMAL);
}

static_assert(static_cast<uint32_t>(domicile::BufferTransform::kFlipped270) ==
                  DOMICILE_BUFFER_TRANSFORM_FLIPPED_270,
              "the header's transforms are the engine's, in the same order");

void domicile_surface_submit_transformed(DomicileEngine* engine,
                                         DomicileSurfaceId surface,
                                         DomicileBufferId buffer,
                                         int32_t crop_x,
                                         int32_t crop_y,
                                         int32_t crop_width,
                                         int32_t crop_height,
                                         int32_t damage_x,
                                         int32_t damage_y,
                                         int32_t damage_width,
                                         int32_t damage_height,
                                         uint64_t box,
                                         DomicileBufferTransform transform) {
  CHECK_LE(transform, DOMICILE_BUFFER_TRANSFORM_FLIPPED_270);
  if (engine) {
    engine->SubmitBuffer(
        surface, domicile::SubmitOf(buffer, crop_x, crop_y, crop_width,
                                    crop_height, damage_x, damage_y,
                                    damage_width, damage_height, box,
                                    transform));
  }
}

void domicile_surface_submit_fenced(DomicileEngine* engine,
                                    DomicileSurfaceId surface,
                                    DomicileBufferId buffer,
                                    int32_t crop_x,
                                    int32_t crop_y,
                                    int32_t crop_width,
                                    int32_t crop_height,
                                    int32_t damage_x,
                                    int32_t damage_y,
                                    int32_t damage_width,
                                    int32_t damage_height,
                                    uint64_t box,
                                    DomicileBufferTransform transform,
                                    int acquire_fence) {
  CHECK_LE(transform, DOMICILE_BUFFER_TRANSFORM_FLIPPED_270);
  if (engine) {
    engine->SubmitFencedBuffer(
        surface,
        domicile::SubmitOf(buffer, crop_x, crop_y, crop_width, crop_height,
                           damage_x, damage_y, damage_width, damage_height,
                           box, transform),
        acquire_fence);
  }
}

void domicile_surface_sync(DomicileEngine* engine,
                           DomicileSurfaceId surface,
                           uint32_t frame) {
  if (engine) {
    engine->SyncSurface(surface, frame);
  }
}

void domicile_displays_configure(DomicileEngine* engine,
                                 const DomicileDisplayLayout* layout,
                                 uint32_t count) {
  // A null array with a nonzero count is a caller bug. A null array with zero
  // count means "no preference".
  if (engine && (layout || count == 0)) {
    engine->ConfigureDisplays(layout, count);
  }
}

void domicile_pointers_configure(DomicileEngine* engine,
                                 const DomicilePointerTarget* targets,
                                 uint32_t count) {
  // A null array with a nonzero count is a caller bug. A null array with zero
  // count binds no device.
  if (engine && (targets || count == 0)) {
    engine->ConfigurePointers(targets, count);
  }
}

void domicile_virtual_displays_configure(DomicileEngine* engine,
                                         const DomicileVirtualDisplay* displays,
                                         uint32_t count) {
  // A null array with a nonzero count is a caller bug. A null array with zero
  // count removes every virtual display.
  if (engine && (displays || count == 0)) {
    engine->ConfigureVirtualDisplays(displays, count);
  }
}

void domicile_clipboard_set(DomicileEngine* engine,
                            DomicileClipboard clipboard,
                            const char* text,
                            size_t length) {
  // A null pointer with a nonzero length is a caller bug. A null pointer with
  // zero length clears the clipboard.
  if (engine && (text || length == 0)) {
    // SAFETY: the ABI says `text` points at `length` bytes valid for this
    // call, and the check above refused a null pointer with a nonzero length.
    // `UNSAFE_BUFFERS` is required to span an ABI pointer and length. The
    // bytes are copied before this returns.
    const auto bytes = UNSAFE_BUFFERS(base::span(text, length));
    base::flat_map<std::string, std::vector<uint8_t>> contents;
    if (length > 0) {
      contents.emplace(domicile::kClipboardText,
                       std::vector<uint8_t>(bytes.begin(), bytes.end()));
    }
    engine->SetClipboard(clipboard, std::move(contents));
  }
}

void domicile_clipboard_set_items(DomicileEngine* engine,
                                  DomicileClipboard clipboard,
                                  const DomicileClipboardItem* items,
                                  uint32_t count) {
  // A null array with a nonzero count is a caller bug. A null array with zero
  // count clears the clipboard.
  if (engine && (items || count == 0)) {
    base::flat_map<std::string, std::vector<uint8_t>> contents;
    if (count > 0) {
      // SAFETY: the ABI says `items` points at `count` records, and each
      // record's `data` at `length` bytes, valid for this call. Everything
      // is copied before this returns.
      for (const DomicileClipboardItem& item :
           UNSAFE_BUFFERS(base::span(items, static_cast<size_t>(count)))) {
        CHECK(item.mime_type);
        CHECK(item.data || item.length == 0);
        const auto bytes = UNSAFE_BUFFERS(base::span(item.data, item.length));
        contents.insert_or_assign(
            std::string(item.mime_type),
            std::vector<uint8_t>(bytes.begin(), bytes.end()));
      }
    }
    engine->SetClipboard(clipboard, std::move(contents));
  }
}

void domicile_buffer_destroy(DomicileEngine* engine,
                             DomicileSurfaceId surface,
                             DomicileBufferId buffer) {
  if (engine) {
    engine->DestroyBuffer(surface, buffer);
  }
}

DomicileCaptureId domicile_display_capture_start(DomicileEngine* engine,
                                                 int64_t display_id,
                                                 uint32_t width,
                                                 uint32_t height,
                                                 uint32_t max_fps) {
  // The browser refuses an empty size or a zero rate as a bad message, which
  // would close the whole connection.
  if (!engine || width == 0 || height == 0 || max_fps == 0) {
    return 0;
  }
  return engine->StartCapture(
      display_id,
      gfx::Size(static_cast<int>(width), static_cast<int>(height)), max_fps);
}

DomicileCaptureId domicile_browser_window_capture_start(DomicileEngine* engine,
                                                        const char* window_id,
                                                        uint32_t max_fps) {
  // The browser refuses a zero rate as a bad message, which would close the
  // whole connection.
  if (!engine || !window_id || max_fps == 0) {
    return 0;
  }
  return engine->StartBrowserWindowCapture(window_id, max_fps);
}

void domicile_display_capture_resize(DomicileEngine* engine,
                                     DomicileCaptureId capture,
                                     uint32_t width,
                                     uint32_t height) {
  if (engine && width != 0 && height != 0) {
    engine->ResizeCapture(
        capture, gfx::Size(static_cast<int>(width), static_cast<int>(height)));
  }
}

void domicile_display_capture_stop(DomicileEngine* engine,
                                   DomicileCaptureId capture) {
  if (engine) {
    engine->StopCapture(capture);
  }
}

void domicile_captured_frame_release(DomicileEngine* engine,
                                     DomicileCaptureId capture,
                                     uint64_t frame) {
  if (engine) {
    engine->ReleaseCapturedFrame(capture, frame);
  }
}

bool domicile_engine_spike_sample_window_center(DomicileEngine* engine,
                                                uint32_t* argb) {
  if (!engine || !argb) {
    return false;
  }
  return engine->SampleWindowCenter(argb);
}

bool domicile_engine_spike_sample_pixel(DomicileEngine* engine,
                                        int32_t x,
                                        int32_t y,
                                        uint32_t* argb) {
  if (!engine || !argb) {
    return false;
  }
  return engine->SamplePixel(x, y, argb);
}

int32_t domicile_engine_spike_find_color(DomicileEngine* engine,
                                         uint32_t argb,
                                         DomicileSpikeCapture* out) {
  if (!engine || !out) {
    return -1;
  }
  return engine->FindColor(argb, out);
}

}  // extern "C"
