// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/domicile_engine.h"

#include <algorithm>
#include <memory>
#include <string>
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
#include "base/no_destructor.h"
#include "base/notreached.h"
#include "base/run_loop.h"
#include "base/synchronization/waitable_event.h"
#include "base/task/single_thread_task_runner.h"
#include "base/threading/thread.h"
#include "components/domicile/engine/engine_event_queue.h"
#include "components/domicile/engine/domicile_engine_spike.h"
#include "components/domicile/engine/surface_alpha.h"
#include "components/domicile/engine/surface_crop.h"
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
#include "ui/gfx/native_pixmap_handle.h"

namespace domicile {
namespace {

// Must match content/browser/domicile/domicile_frame_sink_broker.cc. Integer
// names because ipcz indexes attachments by the first four bytes of the name,
// so string names collide on index 0.
constexpr uint64_t kBrokerPipeName = 0;
// Throwaway; see domicile_engine_spike.h.
constexpr uint64_t kProbePipeName = 1;

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

  // Shows `buffer_id` at the newest box numbered at most `box`. A client's
  // buffer is drawn for the box it acked, so an old buffer stays at its old
  // size and id: viz keeps the page's frame waiting for the new one rather
  // than stretching the old one over it.
  bool Submit(uint64_t buffer_id,
              const gfx::Rect& crop,
              const gfx::Rect& damage,
              uint64_t box,
              domicile::BufferTransform transform) {
    auto iter = buffers_.find(buffer_id);
    if (iter == buffers_.end() || boxes_.empty()) {
      return false;
    }
    // Viz refuses a frame at an older LocalSurfaceId than one it has, so a
    // box once shown is never shown again after a newer one.
    while (boxes_.size() > 1 && boxes_[1].number <= box) {
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
        domicile::QuadForBuffer(transform, shown.size);

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
    frame.resource_list.push_back(iter->second.resource);
    frame.render_pass_list.push_back(std::move(pass));

    sink_->SubmitCompositorFrame(shown.local_surface_id, std::move(frame),
                                 std::nullopt, 0);
    return true;
  }

 private:
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
  // one to deliver a frame's presentation timing. Viz then expects damage from
  // this surface (SurfaceDamageExpected), so an unanswered one makes the
  // display wait for this window until the deadline. Releases do not depend on
  // it: viz returns them with a frame's ack or in ReclaimResources.
  void OnBeginFrame(const viz::BeginFrameArgs& args,
                    const viz::FrameTimingDetailsMap& timing_details,
                    std::vector<viz::ReturnedResource> resources) override {
    Release(resources);
    sink_->DidNotProduceFrame(viz::BeginFrameAck(args, /*has_damage=*/false));
  }
  void DidReceiveCompositorFrameAck(
      std::vector<viz::ReturnedResource> resources) override {
    Release(resources);
  }
  void ReclaimResources(
      std::vector<viz::ReturnedResource> resources) override {
    Release(resources);
  }
  void OnBeginFramePausedChanged(bool paused) override {}
  void OnCompositorFrameTransitionDirectiveProcessed(
      uint32_t sequence_id) override {}
  void OnSurfaceEvicted(const viz::LocalSurfaceId& local_surface_id) override {}

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
  base::flat_map<uint64_t, Adopted> buffers_;
  base::flat_map<viz::ResourceId, uint64_t> resource_to_buffer_;
  viz::ResourceId next_resource_id_{1};
  viz::FrameTokenGenerator next_frame_token_;
};

// The planes DomicileCapturedFrame carries.
constexpr size_t kMostCapturedPlanes =
    std::extent_v<decltype(DomicileCapturedFrame::planes)>;

// One display capture, for a screen cast.
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
             int64_t display_id,
             const gfx::Size& size,
             uint32_t max_fps,
             base::OnceCallback<void(bool)> done) {
    broker->CaptureDisplay(display_id, size, max_fps,
                           control_.BindNewPipeAndPassReceiver(),
                           observer_.BindNewPipeAndPassRemote(),
                           std::move(done));
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
                        .refresh_mhz = one->refresh_mhz});
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
  void OnCopied(mojom::Clipboard clipboard, const std::string& text) override {
    EngineEvent event{.type = EngineEvent::Type::kCopied};
    event.clipboard = clipboard == mojom::Clipboard::kPrimary
                          ? DOMICILE_CLIPBOARD_PRIMARY
                          : DOMICILE_CLIPBOARD_COPY;
    event.copied = text;
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
          if (callbacks_.displays) {
            // Convert to the ABI's record, whose `name` is a `const char*`.
            // The strings belong to `event`, which lives in the drained vector
            // until the loop ends, so they outlive the callback as the header
            // promises.
            std::vector<DomicileDisplay> records;
            records.reserve(event.displays.size());
            for (const domicile::EngineDisplay& display : event.displays) {
              records.push_back(DomicileDisplay{
                  .id = display.id,
                  .name = display.name.c_str(),
                  .x = display.x,
                  .y = display.y,
                  .width = display.width,
                  .height = display.height,
                  .physical_width_mm = display.physical_width_mm,
                  .physical_height_mm = display.physical_height_mm,
                  .refresh_mhz = display.refresh_mhz});
            }
            callbacks_.displays(callbacks_.user_data, records.data(),
                                static_cast<uint32_t>(records.size()));
          }
          break;
        case domicile::EngineEvent::Type::kCopied:
          if (callbacks_.copied) {
            // `event` owns the bytes until the loop ends, as for display names.
            callbacks_.copied(callbacks_.user_data, event.clipboard,
                              event.copied.data(), event.copied.size());
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

  // Blocks; runs once per buffer, not per frame.
  DomicileBufferId ImportBuffer(DomicileSurfaceId surface,
                                const DomicileDmabuf& dmabuf) {
    DomicileBufferId imported = 0;
    RunOnThreadAndWait(base::BindOnce(&DomicileEngine::ImportBufferOnThread,
                                      base::Unretained(this), surface,
                                      std::ref(dmabuf), &imported));
    return imported;
  }

  void SubmitBuffer(DomicileSurfaceId surface,
                    DomicileBufferId buffer,
                    const gfx::Rect& crop,
                    const gfx::Rect& damage,
                    uint64_t box,
                    domicile::BufferTransform transform) {
    thread_.task_runner()->PostTask(
        FROM_HERE, base::BindOnce(&DomicileEngine::SubmitBufferOnThread,
                                  base::Unretained(this), surface, buffer, crop,
                                  damage, box, transform));
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

  // Blocks for the browser's answer, like CreateSurface.
  DomicileCaptureId StartCapture(int64_t display_id,
                                 const gfx::Size& size,
                                 uint32_t max_fps) {
    DomicileCaptureId started = 0;
    RunOnThreadAndWait(base::BindOnce(&DomicileEngine::StartCaptureOnThread,
                                      base::Unretained(this), display_id, size,
                                      max_fps, &started));
    return started;
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
  void SetClipboard(DomicileClipboard clipboard, std::string text) {
    thread_.task_runner()->PostTask(
        FROM_HERE, base::BindOnce(&DomicileEngine::SetClipboardOnThread,
                                  base::Unretained(this), clipboard,
                                  std::move(text)));
  }

 private:
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

  void StartCaptureOnThread(int64_t display_id,
                            const gfx::Size& size,
                            uint32_t max_fps,
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
    raw->Start(broker_.get(), display_id, size, max_fps,
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

  void SetClipboardOnThread(DomicileClipboard clipboard, std::string text) {
    if (broker_) {
      broker_->SetClipboard(clipboard == DOMICILE_CLIPBOARD_PRIMARY
                                ? domicile::mojom::Clipboard::kPrimary
                                : domicile::mojom::Clipboard::kCopy,
                            text);
    }
  }

  void ConfigureDisplaysOnThread(
      std::vector<domicile::mojom::DisplayLayoutPtr> wanted) {
    if (broker_) {
      broker_->ConfigureDisplays(std::move(wanted));
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
                            const DomicileDmabuf& dmabuf,
                            DomicileBufferId* imported) {
    auto iter = surfaces_.find(surface);
    if (iter == surfaces_.end() || !broker_) {
      return;
    }
    gfx::GpuMemoryBufferHandle handle =
        domicile::ToGpuMemoryBufferHandle(dmabuf);
    if (handle.is_null()) {
      return;
    }

    base::RunLoop loop(base::RunLoop::Type::kNestableTasksAllowed);
    domicile::Surface* raw = iter->second.get();
    broker_->ImportBuffer(
        raw->frame_sink_id(), std::move(handle),
        gfx::Size(static_cast<int>(dmabuf.width),
                  static_cast<int>(dmabuf.height)),
        dmabuf.fourcc,
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
            &loop, imported, raw, domicile::FourccHasAlpha(dmabuf.fourcc)));
    loop.Run();
  }

  void SubmitBufferOnThread(DomicileSurfaceId surface,
                            DomicileBufferId buffer,
                            const gfx::Rect& crop,
                            const gfx::Rect& damage,
                            uint64_t box,
                            domicile::BufferTransform transform) {
    auto iter = surfaces_.find(surface);
    if (iter != surfaces_.end()) {
      iter->second->Submit(buffer, crop, damage, box, transform);
    }
  }

  void SampleWindowCenterOnThread(bool* sampled, uint32_t* argb) {
    if (!probe_) {
      return;
    }
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
    loop.Run();
  }

  void SamplePixelOnThread(int32_t x,
                           int32_t y,
                           bool* sampled,
                           uint32_t* argb) {
    if (!probe_) {
      return;
    }
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
    loop.Run();
  }

  void FindColorOnThread(uint32_t argb,
                         int32_t* found,
                         DomicileSpikeCapture* out) {
    if (!probe_) {
      return;
    }
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
    loop.Run();
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
  return engine->ImportBuffer(surface, *dmabuf);
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
        surface, buffer, gfx::Rect(crop_x, crop_y, crop_width, crop_height),
        gfx::Rect(damage_x, damage_y, damage_width, damage_height), box,
        static_cast<domicile::BufferTransform>(transform));
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
    // string is copied before this returns.
    const auto bytes = UNSAFE_BUFFERS(base::span(text, length));
    engine->SetClipboard(clipboard, std::string(bytes.begin(), bytes.end()));
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
