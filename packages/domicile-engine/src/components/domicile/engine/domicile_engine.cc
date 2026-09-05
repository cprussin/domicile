// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/engine/domicile_engine.h"

#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/at_exit.h"
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
#include "components/domicile/mojom/frame_sink_broker.mojom.h"
#include "components/viz/common/frame_sinks/begin_frame_args.h"
#include "components/viz/common/frame_timing_details_map.h"
#include "components/viz/common/resources/returned_resource.h"
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
#include "ui/gfx/geometry/size.h"

namespace domicile {
namespace {

// Must match content/browser/domicile/domicile_frame_sink_broker.cc. Integer
// names, and see the comment there: under ipcz an attachment is indexed by the
// first four bytes of its name, so string-named attachments all collide on
// index 0.
constexpr uint64_t kBrokerPipeName = 0;

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

// One brokered frame sink, and the client half viz talks back through.
//
// Everything here runs on the engine's mojo thread. The only thing that leaves
// it is a push onto the EngineEventQueue, which is what the compositor polls.
class Surface : public viz::mojom::CompositorFrameSinkClient,
                public mojom::SurfaceObserver {
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
    // Asked for once and only once an embedder exists, because until one does
    // there is nothing to drive: registering the frame sink is what creates
    // the sink, and registering the hierarchy — which Embed() does on the
    // browser side — is what makes BeginFrames arrive. Step 2 measured that
    // those are two different things.
    if (!wants_begin_frames_) {
      wants_begin_frames_ = true;
      sink_->SetNeedsBeginFrame(true);
    }
    queue_->Push({.type = EngineEvent::Type::kConfigure,
                  .surface = id_,
                  .width = static_cast<uint32_t>(size.width()),
                  .height = static_cast<uint32_t>(size.height())});
  }

  // viz::mojom::CompositorFrameSinkClient:
  void OnBeginFrame(const viz::BeginFrameArgs& args,
                    const viz::FrameTimingDetailsMap& timing_details,
                    std::vector<viz::ReturnedResource> resources) override {
    ReturnResources(resources);
    queue_->Push({.type = EngineEvent::Type::kFrame,
                  .surface = id_,
                  .deadline_us = static_cast<uint64_t>(
                      args.deadline.since_origin().InMicroseconds())});
  }

  void DidReceiveCompositorFrameAck(
      std::vector<viz::ReturnedResource> resources) override {
    ReturnResources(resources);
  }

  void ReclaimResources(
      std::vector<viz::ReturnedResource> resources) override {
    ReturnResources(resources);
  }

  // A resource viz hands back is a buffer it has stopped sampling, which is
  // exactly wl_buffer.release. Nothing submits resources yet — that is
  // domicile_surface_import's half — so this does not fire, and it is here
  // rather than later because the lifecycle stops being optional the moment it
  // does.
  void ReturnResources(const std::vector<viz::ReturnedResource>& resources) {
    for (const viz::ReturnedResource& resource : resources) {
      queue_->Push({.type = EngineEvent::Type::kReleased,
                    .surface = id_,
                    .buffer = resource.id.GetUnsafeValue()});
    }
  }

  void OnBeginFramePausedChanged(bool paused) override {}
  void OnCompositorFrameTransitionDirectiveProcessed(
      uint32_t sequence_id) override {}
  void OnSurfaceEvicted(const viz::LocalSurfaceId& local_surface_id) override {}

  const DomicileSurfaceId id_;
  const raw_ptr<EngineEventQueue> queue_;

  mojo::Remote<viz::mojom::CompositorFrameSink> sink_;
  mojo::Receiver<viz::mojom::CompositorFrameSinkClient> client_receiver_{this};
  mojo::Receiver<mojom::SurfaceObserver> observer_receiver_{this};

  viz::FrameSinkId frame_sink_id_;
  viz::LocalSurfaceId local_surface_id_;
  bool wants_begin_frames_ = false;
};

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

  void TearDown() {
    surfaces_.clear();
    broker_.reset();
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

}  // extern "C"
