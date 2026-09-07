// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/engine/domicile_engine.h"

#include <algorithm>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/at_exit.h"
#include "base/containers/span.h"
#include "base/containers/flat_map.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/message_loop/message_pump_type.h"
#include "base/memory/raw_ptr.h"
#include "base/no_destructor.h"
#include "base/run_loop.h"
#include "base/synchronization/waitable_event.h"
#include "base/task/single_thread_task_runner.h"
#include "base/threading/thread.h"
#include "components/domicile/engine/engine_event_queue.h"
#include "components/domicile/engine/domicile_engine_spike.h"
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
#include "ui/gfx/geometry/size.h"
#include "ui/gfx/gpu_memory_buffer_handle.h"
#include "ui/gfx/geometry/transform.h"
#include "ui/gfx/native_pixmap_handle.h"

namespace domicile {
namespace {

// Must match content/browser/domicile/domicile_frame_sink_broker.cc. Integer
// names, and see the comment there: under ipcz an attachment is indexed by the
// first four bytes of its name, so string-named attachments all collide on
// index 0.
constexpr uint64_t kBrokerPipeName = 0;
// THROWAWAY, with domicile_engine_spike.h: the probe the browser attaches
// beside the broker so a harness can ask what viz drew.
constexpr uint64_t kProbePipeName = 1;

// Once per process, however many engines are created and destroyed.
//
// The compositor is not a Chromium process and has no idea it is hosting one,
// so the library brings its own AtExitManager and mojo core. Both are
// process-global and neither can be torn down and re-created, which is why they
// outlive every engine rather than belonging to one.
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
// Everything here runs on the engine's mojo thread. The only thing that leaves
// it is a push onto the EngineEventQueue, which is what the compositor polls.
//
// It holds its own CompositorFrameSink and assembles its own frames, which is
// the thing ENGINE-FORK.md's "Whether the producer can submit its own frames"
// asks about. It still mints no mailbox and holds no GPU channel: the browser
// imports the dmabuf and hands back a gpu::ExportedSharedImage — a mailbox and
// a verified sync token, bytes once verified — and naming one is not authority
// to make one.
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
  }

  const viz::FrameSinkId& frame_sink_id() const { return frame_sink_id_; }

  // Takes the SharedImage the browser made and keeps it under `buffer_id`, so
  // a later Submit can name it in a resource list.
  void Adopt(uint64_t buffer_id, gpu::ExportedSharedImage exported) {
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
    buffers_[buffer_id] = {std::move(shared_image), std::move(resource)};
  }

  void Forget(uint64_t buffer_id) {
    auto iter = buffers_.find(buffer_id);
    if (iter != buffers_.end()) {
      resource_to_buffer_.erase(iter->second.resource.id);
      buffers_.erase(iter);
    }
  }

  bool Submit(uint64_t buffer_id, const gfx::Rect& damage) {
    auto iter = buffers_.find(buffer_id);
    if (iter == buffers_.end() || !local_surface_id_.is_valid()) {
      return false;
    }
    const gfx::Rect rect(size_);

    auto pass = viz::CompositorRenderPass::Create();
    pass->SetNew(viz::CompositorRenderPassId{1}, rect,
                 damage.IsEmpty() ? rect : damage, gfx::Transform());

    viz::SharedQuadState* quad_state = pass->CreateAndAppendSharedQuadState();
    quad_state->SetAll(gfx::Transform(), rect, rect, gfx::MaskFilterInfo(),
                       /*clip=*/std::nullopt, /*contents_opaque=*/true,
                       /*opacity_f=*/1.f, SkBlendMode::kSrcOver,
                       /*sorting_context=*/0, /*layer_id=*/0u,
                       /*fast_rounded_corner=*/false);

    viz::TextureDrawQuad* quad =
        pass->CreateAndAppendDrawQuad<viz::TextureDrawQuad>();
    quad->SetNew(quad_state, rect, rect, /*needs_blending=*/false,
                 iter->second.resource.id, gfx::PointF(0.f, 0.f),
                 gfx::PointF(1.f, 1.f), SkColors::kTransparent,
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

    sink_->SubmitCompositorFrame(local_surface_id_, std::move(frame),
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
  // The page allocated this id and picked this size; nothing here chose either.
  // For the compositor this is an xdg_toplevel.configure.
  void OnSurfaceEmbedded(const viz::LocalSurfaceId& local_surface_id,
                         const gfx::Size& size) override {
    local_surface_id_ = local_surface_id;
    size_ = size;
    if (!wants_begin_frames_) {
      wants_begin_frames_ = true;
      sink_->SetNeedsBeginFrame(true);
    }
    queue_->Push({.type = EngineEvent::Type::kConfigure,
                  .surface = id_,
                  .width = static_cast<uint32_t>(size.width()),
                  .height = static_cast<uint32_t>(size.height())});
  }

  // Only sent when the browser owns the sink, which this does not ask for.
  void OnFrame(int64_t deadline_us) override {}
  void OnBufferReleased(uint64_t buffer_id) override {}

  // viz::mojom::CompositorFrameSinkClient:
  void OnBeginFrame(const viz::BeginFrameArgs& args,
                    const viz::FrameTimingDetailsMap& timing_details,
                    std::vector<viz::ReturnedResource> resources) override {
    Release(resources);
    queue_->Push({.type = EngineEvent::Type::kFrame,
                  .surface = id_,
                  .deadline_us = static_cast<uint64_t>(
                      args.deadline.since_origin().InMicroseconds())});
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

  // wl_buffer.release: viz has stopped sampling that dmabuf and the client may
  // draw into it again.
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
  };

  const DomicileSurfaceId id_;
  const raw_ptr<EngineEventQueue> queue_;

  mojo::Receiver<mojom::SurfaceObserver> observer_receiver_{this};
  mojo::Remote<viz::mojom::CompositorFrameSink> sink_;
  mojo::Receiver<viz::mojom::CompositorFrameSinkClient> client_receiver_{this};

  viz::FrameSinkId frame_sink_id_;
  viz::LocalSurfaceId local_surface_id_;
  gfx::Size size_;
  bool wants_begin_frames_ = false;
  base::flat_map<uint64_t, Adopted> buffers_;
  base::flat_map<viz::ResourceId, uint64_t> resource_to_buffer_;
  viz::ResourceId next_resource_id_{1};
  viz::FrameTokenGenerator next_frame_token_;
};

// A client's dmabuf, as mojo wants it. The fds are duplicated: the caller keeps
// the originals, which is what a compositor holding a wl_buffer expects.
gfx::GpuMemoryBufferHandle ToGpuMemoryBufferHandle(
    const DomicileDmabuf& dmabuf) {
  gfx::NativePixmapHandle pixmap;
  pixmap.modifier = dmabuf.modifier;
  // Through a span because the ABI carries a fixed C array and a raw index into
  // one is not something -Wunsafe-buffer-usage will take.
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

}  // namespace
}  // namespace domicile

// The engine itself. Deliberately outside the namespace: the C ABI names this
// type, and an opaque struct in the global namespace is what a `struct
// DomicileEngine;` forward declaration in a C header means.
struct DomicileEngine {
 public:
  explicit DomicileEngine(DomicileEngineCallbacks callbacks)
      : callbacks_(callbacks), thread_("domicile-engine") {}

  DomicileEngine(const DomicileEngine&) = delete;
  DomicileEngine& operator=(const DomicileEngine&) = delete;

  ~DomicileEngine() {
    if (thread_.IsRunning()) {
      // The mojo objects were made on that thread and have to die on it.
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

  // On the caller's thread, which is the whole point of the fd.
  void Dispatch() {
    for (const domicile::EngineEvent& event : queue_.Drain()) {
      switch (event.type) {
        case domicile::EngineEvent::Type::kConfigure:
          if (callbacks_.configure) {
            callbacks_.configure(callbacks_.user_data, event.surface,
                                 event.width, event.height);
          }
          break;
        case domicile::EngineEvent::Type::kFrame:
          if (callbacks_.frame) {
            callbacks_.frame(callbacks_.user_data, event.surface,
                             event.deadline_us);
          }
          break;
        case domicile::EngineEvent::Type::kReleased:
          if (callbacks_.released) {
            callbacks_.released(callbacks_.user_data, event.surface,
                                event.buffer);
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

  // Blocking, and only once per buffer rather than once per frame: the caller
  // cannot attach a buffer that does not exist yet.
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
                    const gfx::Rect& damage) {
    thread_.task_runner()->PostTask(
        FROM_HERE,
        base::BindOnce(&DomicileEngine::SubmitBufferOnThread,
                       base::Unretained(this), surface, buffer, damage));
  }

  // THROWAWAY. See domicile_engine_spike.h.
  bool SampleWindowCenter(uint32_t* argb) {
    bool sampled = false;
    RunOnThreadAndWait(base::BindOnce(
        &DomicileEngine::SampleWindowCenterOnThread, base::Unretained(this),
        &sampled, argb));
    return sampled;
  }

  // THROWAWAY. See domicile_engine_spike.h.
  bool SamplePixel(int32_t x, int32_t y, uint32_t* argb) {
    bool sampled = false;
    RunOnThreadAndWait(base::BindOnce(&DomicileEngine::SamplePixelOnThread,
                                      base::Unretained(this), x, y, &sampled,
                                      argb));
    return sampled;
  }

  // THROWAWAY. See domicile_engine_spike.h.
  int32_t FindColour(uint32_t argb, int32_t* out) {
    int32_t found = -1;
    RunOnThreadAndWait(base::BindOnce(&DomicileEngine::FindColourOnThread,
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

 private:
  void ConnectOnThread(const std::string& socket_path, bool* connected) {
    mojo::PlatformChannelEndpoint endpoint =
        mojo::NamedPlatformChannel::ConnectToServer(
            mojo::NamedPlatformChannel::ServerNameFromUTF8(socket_path));
    if (!endpoint.is_valid()) {
      LOG(ERROR) << "domicile: no browser listening at " << socket_path;
      *connected = false;
      return;
    }

    // A real invitation over a named socket rather than a
    // mojo::IsolatedConnection, and that is forced rather than chosen: the
    // broker forwards our CompositorFrameSink receiver on to the viz process,
    // and an isolated connection cannot carry a handle that far. See
    // ENGINE-FORK.md, "How the producer reaches the broker".
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

    // Synchronous because the ABI is: the caller gets a usable surface or a
    // zero, and a window that does not exist yet is not something the
    // compositor can hold.
    // Runs this thread's own loop while the browser answers rather than
    // blocking it, because the reply arrives on this thread. The caller is
    // parked on a WaitableEvent in RunOnThreadAndWait meanwhile.
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

  void DestroySurfaceOnThread(DomicileSurfaceId surface) {
    surfaces_.erase(surface);
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
               domicile::Surface* surface, uint64_t id,
               std::optional<gpu::ExportedSharedImage> exported) {
              // Naming the browser's SharedImage is what lets this process
              // build its own TransferableResource. Without it there is
              // nothing to submit, so the import counts as refused.
              if (id != 0 && exported.has_value()) {
                surface->Adopt(id, std::move(exported).value());
                *imported = id;
              }
              loop->Quit();
            },
            &loop, imported, raw));
    loop.Run();
  }

  void SubmitBufferOnThread(DomicileSurfaceId surface,
                            DomicileBufferId buffer,
                            const gfx::Rect& damage) {
    auto iter = surfaces_.find(surface);
    if (iter != surfaces_.end()) {
      iter->second->Submit(buffer, damage);
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
               uint32_t colour) {
              *sampled = ok;
              *argb = colour;
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
               uint32_t colour) {
              *sampled = ok;
              *argb = colour;
              loop->Quit();
            },
            &loop, sampled, argb));
    loop.Run();
  }

  void FindColourOnThread(uint32_t argb, int32_t* found, int32_t* out) {
    if (!probe_) {
      return;
    }
    base::RunLoop loop(base::RunLoop::Type::kNestableTasksAllowed);
    probe_->CaptureWindow(base::BindOnce(
        [](base::RunLoop* loop, uint32_t wanted, int32_t* found, int32_t* out,
           bool captured, const gfx::Size& size,
           const std::vector<uint32_t>& pixels) {
          if (captured && size.width() > 0 && size.height() > 0) {
            // Bounded by the smaller of what arrived and what `size` says: a
            // short reply must not be read past, and a long one must not
            // report a row below the bottom of the window.
            const size_t width = static_cast<size_t>(size.width());
            const size_t area = width * static_cast<size_t>(size.height());
            const size_t last = std::min(area, pixels.size());

            // The whole extent, not the first pixel — see the header. Walked
            // once, row-major, keeping the corners.
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

            out[4] = size.width();
            out[5] = size.height();
            if (right < 0) {
              *found = 0;
            } else {
              *found = 1;
              out[0] = left;
              out[1] = top;
              out[2] = right - left + 1;
              out[3] = bottom - top + 1;
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
    surfaces_.clear();
    broker_.reset();
    // Bound on this thread, so it has to die on it: a mojo::Remote validates
    // the sequence it is destroyed on.
    probe_.reset();
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
  base::Thread thread_;
  std::unique_ptr<mojo::core::ScopedIPCSupport> ipc_support_;
  mojo::Remote<domicile::mojom::FrameSinkBroker> broker_;
  // THROWAWAY. See domicile_engine_spike.h.
  mojo::Remote<domicile::mojom::SpikeProbe> probe_;
  base::flat_map<DomicileSurfaceId, std::unique_ptr<domicile::Surface>>
      surfaces_;
  DomicileSurfaceId next_surface_id_ = 1;
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
  if (engine) {
    engine->SubmitBuffer(
        surface, buffer,
        gfx::Rect(damage_x, damage_y, damage_width, damage_height));
  }
}

void domicile_buffer_destroy(DomicileEngine* engine,
                             DomicileSurfaceId surface,
                             DomicileBufferId buffer) {
  if (engine) {
    engine->DestroyBuffer(surface, buffer);
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

int32_t domicile_engine_spike_find_colour(DomicileEngine* engine,
                                          uint32_t argb,
                                          int32_t* out) {
  if (!engine || !out) {
    return -1;
  }
  return engine->FindColour(argb, out);
}

}  // extern "C"
