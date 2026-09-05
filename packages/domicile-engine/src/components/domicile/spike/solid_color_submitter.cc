// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// THROWAWAY. The spike's producer, standing in for domicile-compositor until it
// submits real buffers. See docs/architecture/ENGINE-FORK.md.
//
// A viz client in a process the browser did not launch, does not sandbox, and
// has no RenderProcessHost for. It joins the browser's mojo graph over a named
// socket, asks domicile::FrameSinkBroker for a frame sink, waits to be told
// which surface a page embedded it at, submits solid-colour CompositorFrames to
// that surface, and then asks the browser what colour it actually drew.
//
// It exits 0 only if that colour is the one it submitted. In step 2 that
// answered "does viz aggregate frames from a producer that is not a renderer?".
// Here the embedder is a <canvas> in an ordinary web page rather than a
// ui::LayerSurface in the browser's own window, so the same exit code answers
// step 3: does a page's cc::SurfaceLayer embed a surface the page did not
// allocate?
//
// Note what this no longer does. It does not ask to be embedded, and it does
// not allocate a LocalSurfaceId. The embedder does both, and this adopts what
// it is given — which is the direction RemoteFrame uses, and the direction a
// compositor telling a client to resize has to run in.
//
// packages/domicile-engine/scripts/spike.sh in the Domicile repository runs
// both halves and has the engine flags this needs.

#include <cinttypes>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/at_exit.h"
#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/message_loop/message_pump_type.h"
#include "base/run_loop.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/stringprintf.h"
#include "base/task/single_thread_task_executor.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool/thread_pool_instance.h"
#include "base/threading/thread.h"
#include "base/time/time.h"
#include "components/domicile/mojom/frame_sink_broker.mojom.h"
#include "components/domicile/spike/mojom/spike_probe.mojom.h"
#include "components/viz/common/frame_timing_details_map.h"
#include "components/viz/common/quads/compositor_frame.h"
#include "components/viz/common/quads/compositor_render_pass.h"
#include "components/viz/common/quads/solid_color_draw_quad.h"
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
#include "third_party/skia/include/core/SkColor.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"
#include "ui/gfx/geometry/transform.h"

namespace {

// Must match content/browser/domicile/domicile_frame_sink_broker.cc.
constexpr char kSocketSwitch[] = "domicile-broker-socket";
// Integer names, matching that file — see the comment there: under ipcz,
// string-named attachments all collide on index 0.
constexpr uint64_t kBrokerPipeName = 0;
constexpr uint64_t kProbePipeName = 1;

constexpr char kColorSwitch[] = "color";

// How long to wait for a page to embed us. The engine has to start, load a
// page, and the page has to call canvas.embedExternalSurface(); the producer
// may well win that race, and waiting here rather than failing keeps the
// ordering out of the harness.
constexpr base::TimeDelta kEmbedTimeout = base::Seconds(60);

// Frames to submit before asking what got drawn. A surface is embedded with a
// deadline and the first draw after activation is what the copy request rides
// on, so this is just "long enough".
constexpr int kFramesBeforeSampling = 5;

// If no BeginFrame arrives, sample anyway: the first frame is submitted with a
// manual ack, so there is something to aggregate whether or not viz ever asks
// for more. Which of the two happened is the interesting part — hierarchy
// registration is what makes BeginFrames flow, and in step 3 the page is what
// asks for it — so it is reported either way.
constexpr base::TimeDelta kBeginFrameGrace = base::Seconds(3);
constexpr int kSampleTries = 40;
constexpr base::TimeDelta kSampleInterval = base::Milliseconds(100);

// Colour comparison is per-channel with slack: the display's colour space is
// not necessarily the one the quad was authored in, and SkiaRenderer may round
// through it. An exact match is not the claim; "the colour we submitted, not
// the page's background" is.
constexpr int kChannelTolerance = 4;

bool ColorsMatch(SkColor a, SkColor b) {
  auto near = [](uint32_t x, uint32_t y) {
    return static_cast<int>(x > y ? x - y : y - x) <= kChannelTolerance;
  };
  return near(SkColorGetA(a), SkColorGetA(b)) &&
         near(SkColorGetR(a), SkColorGetR(b)) &&
         near(SkColorGetG(a), SkColorGetG(b)) &&
         near(SkColorGetB(a), SkColorGetB(b));
}

std::string ToHex(SkColor color) {
  return base::StringPrintf("#%08X", color);
}

class SolidColorSubmitter : public viz::mojom::CompositorFrameSinkClient,
                            public domicile::mojom::SurfaceObserver {
 public:
  SolidColorSubmitter(SkColor color, base::OnceCallback<void(bool)> done)
      : color_(color), done_(std::move(done)) {}

  SolidColorSubmitter(const SolidColorSubmitter&) = delete;
  SolidColorSubmitter& operator=(const SolidColorSubmitter&) = delete;

  ~SolidColorSubmitter() override = default;

  // Joins the browser's mojo graph and takes both pipes off the invitation.
  //
  // This is a real invitation over a named socket rather than a
  // mojo::IsolatedConnection, and that is forced rather than chosen: the broker
  // forwards our CompositorFrameSink receiver on to the viz process, and an
  // isolated connection's own header says a handle it carries "cannot [be
  // passed] to yet another process". See ENGINE-FORK.md, "How the producer
  // reaches the broker".
  bool Connect(const mojo::NamedPlatformChannel::ServerName& socket) {
    mojo::PlatformChannelEndpoint endpoint =
        mojo::NamedPlatformChannel::ConnectToServer(socket);
    if (!endpoint.is_valid()) {
      LOG(ERROR) << "no server at " << socket;
      return false;
    }

    mojo::IncomingInvitation invitation =
        mojo::IncomingInvitation::Accept(std::move(endpoint));
    if (!invitation.is_valid()) {
      LOG(ERROR) << "invitation refused";
      return false;
    }

    broker_.Bind(mojo::PendingRemote<domicile::mojom::FrameSinkBroker>(
        invitation.ExtractMessagePipe(kBrokerPipeName), 0));
    probe_.Bind(mojo::PendingRemote<domicile::mojom::SpikeProbe>(
        invitation.ExtractMessagePipe(kProbePipeName), 0));
    broker_.set_disconnect_handler(base::BindOnce(
        &SolidColorSubmitter::OnBrokerDisconnected, base::Unretained(this)));
    return true;
  }

  void Start() {
    mojo::PendingRemote<viz::mojom::CompositorFrameSinkClient> client;
    client_receiver_.Bind(client.InitWithNewPipeAndPassReceiver());
    broker_->CreateFrameSink(
        std::move(client), sink_.BindNewPipeAndPassReceiver(),
        observer_receiver_.BindNewPipeAndPassRemote(),
        base::BindOnce(&SolidColorSubmitter::OnFrameSinkCreated,
                       base::Unretained(this)));
  }

 private:
  void OnFrameSinkCreated(const viz::FrameSinkId& frame_sink_id) {
    printf("brokered frame sink: %s\n", frame_sink_id.ToString().c_str());
    frame_sink_id_ = frame_sink_id;
    printf("waiting for a page to embed it...\n");

    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE,
        base::BindOnce(&SolidColorSubmitter::OnEmbedTimeout,
                       base::Unretained(this)),
        kEmbedTimeout);
  }

  // domicile::mojom::SurfaceObserver:
  //
  // The page allocated this LocalSurfaceId and picked this size. Nothing here
  // chose either, and nothing here could have: the embed_token in the id is the
  // embedder's to mint, and the size is its layout box.
  void OnSurfaceEmbedded(const viz::LocalSurfaceId& local_surface_id,
                         const gfx::Size& size) override {
    printf("a page embedded us: %s at %s\n",
           local_surface_id.ToString().c_str(), size.ToString().c_str());
    local_surface_id_ = local_surface_id;
    size_ = size;

    if (submitting_) {
      // A resize, which is the same message. Nothing else to do: the next
      // frame goes to the new id.
      return;
    }
    submitting_ = true;

    // One frame straight away so the surface activates without waiting on the
    // BeginFrame that embedding just unblocked.
    Submit(viz::BeginFrameAck::CreateManualAckWithDamage());
    sink_->SetNeedsBeginFrame(true);

    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE,
        base::BindOnce(&SolidColorSubmitter::MaybeStartSampling,
                       base::Unretained(this)),
        kBeginFrameGrace);
  }

  void OnEmbedTimeout() {
    if (submitting_) {
      return;
    }
    printf("NOT embedded: no page asked for this surface in %" PRId64 "s\n",
           kEmbedTimeout.InSeconds());
    Finish(false);
  }

  void MaybeStartSampling() {
    if (sampling_started_) {
      return;
    }
    sampling_started_ = true;
    if (!begin_frames_seen_) {
      printf("no BeginFrames after %" PRId64 "s; sampling anyway\n",
             kBeginFrameGrace.InSeconds());
    }
    Sample();
  }

  void Submit(const viz::BeginFrameAck& ack) {
    const gfx::Rect rect(size_);

    auto pass = viz::CompositorRenderPass::Create();
    pass->SetNew(viz::CompositorRenderPassId{1}, rect, rect, gfx::Transform());

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

    viz::SolidColorDrawQuad* quad =
        pass->CreateAndAppendDrawQuad<viz::SolidColorDrawQuad>();
    quad->SetNew(quad_state, rect, rect, SkColor4f::FromColor(color_),
                 /*anti_aliasing_off=*/false);

    viz::CompositorFrame frame;
    frame.metadata.begin_frame_ack = ack;
    frame.metadata.device_scale_factor = 1.f;
    frame.metadata.frame_token = ++next_frame_token_;
    frame.render_pass_list.push_back(std::move(pass));

    sink_->SubmitCompositorFrame(local_surface_id_, std::move(frame),
                                 /*hit_test_region_list=*/std::nullopt,
                                 /*submit_time=*/0);
    ++frames_submitted_;
  }

  void Sample() {
    probe_->SampleWindowCenter(base::BindOnce(&SolidColorSubmitter::OnSampled,
                                              base::Unretained(this)));
  }

  void OnSampled(bool sampled, uint32_t argb) {
    if (sampled && ColorsMatch(argb, color_)) {
      printf("aggregated: drew %s, submitted %s\n", ToHex(argb).c_str(),
             ToHex(color_).c_str());
      Finish(true);
      return;
    }

    if (++sample_tries_ >= kSampleTries) {
      if (sampled) {
        printf("NOT aggregated: drew %s, submitted %s\n", ToHex(argb).c_str(),
               ToHex(color_).c_str());
      } else {
        printf("NOT aggregated: the browser never drew its window\n");
      }
      Finish(false);
      return;
    }

    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE,
        base::BindOnce(&SolidColorSubmitter::Sample, base::Unretained(this)),
        kSampleInterval);
  }

  void OnBrokerDisconnected() {
    LOG(ERROR) << "the browser dropped the broker connection";
    Finish(false);
  }

  void Finish(bool ok) {
    if (done_) {
      std::move(done_).Run(ok);
    }
  }

  // viz::mojom::CompositorFrameSinkClient:
  void DidReceiveCompositorFrameAck(
      std::vector<viz::ReturnedResource> resources) override {}
  void OnBeginFrame(const viz::BeginFrameArgs& args,
                    const viz::FrameTimingDetailsMap& timing_details,
                    std::vector<viz::ReturnedResource> resources) override {
    if (!begin_frames_seen_++) {
      printf("BeginFrames are flowing\n");
    }
    if (!submitting_) {
      return;
    }
    Submit(viz::BeginFrameAck(args, true));
    if (frames_submitted_ >= kFramesBeforeSampling) {
      MaybeStartSampling();
    }
  }
  void OnBeginFramePausedChanged(bool paused) override {}
  void ReclaimResources(std::vector<viz::ReturnedResource> resources) override {
  }
  void OnCompositorFrameTransitionDirectiveProcessed(
      uint32_t sequence_id) override {}
  void OnSurfaceEvicted(const viz::LocalSurfaceId& local_surface_id) override {}

  const SkColor color_;
  base::OnceCallback<void(bool)> done_;

  mojo::Remote<domicile::mojom::FrameSinkBroker> broker_;
  mojo::Remote<domicile::mojom::SpikeProbe> probe_;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink_;
  mojo::Receiver<viz::mojom::CompositorFrameSinkClient> client_receiver_{this};
  mojo::Receiver<domicile::mojom::SurfaceObserver> observer_receiver_{this};

  viz::FrameSinkId frame_sink_id_;
  viz::LocalSurfaceId local_surface_id_;
  gfx::Size size_;
  viz::FrameTokenGenerator next_frame_token_;
  bool submitting_ = false;
  int frames_submitted_ = 0;
  int begin_frames_seen_ = 0;
  int sample_tries_ = 0;
  bool sampling_started_ = false;
};

SkColor ParseColor(const base::CommandLine& command_line) {
  constexpr SkColor kDefault = SkColorSetARGB(0xFF, 0xFF, 0x00, 0xFF);
  if (!command_line.HasSwitch(kColorSwitch)) {
    return kDefault;
  }
  uint32_t value = 0;
  if (!base::HexStringToUInt(command_line.GetSwitchValueASCII(kColorSwitch),
                             &value)) {
    LOG(ERROR) << "--color wants AARRGGBB hex; using the default";
    return kDefault;
  }
  return value;
}

}  // namespace

int main(int argc, char** argv) {
  base::AtExitManager exit_manager;
  base::CommandLine::Init(argc, argv);
  const base::CommandLine& command_line =
      *base::CommandLine::ForCurrentProcess();

  const std::string socket = command_line.GetSwitchValueASCII(kSocketSwitch);
  if (socket.empty()) {
    LOG(ERROR) << "usage: domicile_solid_color_submitter --" << kSocketSwitch
               << "=<path> [--color=AARRGGBB]";
    return 2;
  }

  base::SingleThreadTaskExecutor main_task_executor;
  base::ThreadPoolInstance::CreateAndStartWithDefaultParams("submitter");

  mojo::core::Init();
  base::Thread ipc_thread("mojo");
  ipc_thread.StartWithOptions(
      base::Thread::Options(base::MessagePumpType::IO, 0));
  mojo::core::ScopedIPCSupport ipc_support(
      ipc_thread.task_runner(),
      mojo::core::ScopedIPCSupport::ShutdownPolicy::CLEAN);

  base::RunLoop run_loop;
  bool ok = false;
  SolidColorSubmitter submitter(
      ParseColor(command_line),
      base::BindOnce(
          [](bool* ok, base::OnceClosure quit, bool result) {
            *ok = result;
            std::move(quit).Run();
          },
          &ok, run_loop.QuitClosure()));

  if (!submitter.Connect(
          mojo::NamedPlatformChannel::ServerNameFromUTF8(socket))) {
    return 1;
  }
  submitter.Start();
  run_loop.Run();

  return ok ? 0 : 1;
}
