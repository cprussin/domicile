// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// THROWAWAY. Step 2 of the spike in docs/architecture/ENGINE-FORK.md.
//
// A viz client in a process the browser did not launch, does not sandbox, and
// has no RenderProcessHost for. It joins the browser's mojo graph over a named
// socket, asks domicile::FrameSinkBroker for a frame sink, gets the browser to
// embed the resulting surface, submits solid-colour CompositorFrames to it, and
// then asks the browser what colour it actually drew.
//
// It exits 0 only if that colour is the one it submitted, which is the whole
// question step 2 asks: does viz aggregate frames from a producer that is not
// a renderer?
//
// packages/domicile-engine/scripts/spike.sh in the Domicile repository runs
// both halves and has the engine flags this needs.
//
// Everything here is deleted once the real compositor submits real buffers.

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
#include "components/domicile/spike/mojom/spike_embedder.mojom.h"
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

// Must match content/browser/domicile/domicile_spike.cc.
constexpr char kSocketSwitch[] = "domicile-broker-socket";
// Integer names, matching domicile_spike.cc — see the comment there: under
// ipcz, string-named attachments all collide on index 0.
constexpr uint64_t kBrokerPipeName = 0;
constexpr uint64_t kEmbedderPipeName = 1;

constexpr char kColorSwitch[] = "color";
constexpr char kSizeSwitch[] = "size";

// Frames to submit before asking what got drawn, and tries to give the
// browser to draw one. A surface is embedded with a deadline, and the first
// draw after activation is what the copy request rides on, so neither number
// is load-bearing — they are just "long enough".
constexpr int kFramesBeforeSampling = 5;

// If no BeginFrame arrives, sample anyway: the first frame is submitted with a
// manual ack, so there is something to aggregate whether or not viz ever asks
// for more. Which of the two happened is the interesting part, so it is
// reported either way.
constexpr base::TimeDelta kBeginFrameGrace = base::Seconds(3);
constexpr int kSampleTries = 40;
constexpr base::TimeDelta kSampleInterval = base::Milliseconds(100);

// Colour comparison is per-channel with slack: the display's colour space is
// not necessarily the one the quad was authored in, and SkiaRenderer may round
// through it. An exact match is not the claim; "the colour we submitted, not
// the fallback" is.
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

class SolidColorSubmitter : public viz::mojom::CompositorFrameSinkClient {
 public:
  SolidColorSubmitter(SkColor color,
                      const gfx::Size& size,
                      base::OnceCallback<void(bool)> done)
      : color_(color), size_(size), done_(std::move(done)) {}

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
    embedder_.Bind(mojo::PendingRemote<domicile::mojom::SpikeEmbedder>(
        invitation.ExtractMessagePipe(kEmbedderPipeName), 0));
    broker_.set_disconnect_handler(base::BindOnce(
        &SolidColorSubmitter::OnBrokerDisconnected, base::Unretained(this)));
    return true;
  }

  void Start() {
    mojo::PendingRemote<viz::mojom::CompositorFrameSinkClient> client;
    client_receiver_.Bind(client.InitWithNewPipeAndPassReceiver());
    broker_->CreateFrameSink(
        std::move(client), sink_.BindNewPipeAndPassReceiver(),
        base::BindOnce(&SolidColorSubmitter::OnFrameSinkCreated,
                       base::Unretained(this)));
  }

 private:
  void OnFrameSinkCreated(const viz::FrameSinkId& frame_sink_id) {
    printf("brokered frame sink: %s\n", frame_sink_id.ToString().c_str());
    frame_sink_id_ = frame_sink_id;

    // Nothing has referenced the surface yet, so submitting now would only
    // create one viz garbage-collects. The embedder goes first, and it is the
    // embedder that mints the LocalSurfaceId.
    embedder_->Embed(frame_sink_id, size_,
                     base::BindOnce(&SolidColorSubmitter::OnEmbedded,
                                    base::Unretained(this)));
  }

  void OnEmbedded(const std::optional<viz::LocalSurfaceId>& local_surface_id) {
    if (!local_surface_id) {
      LOG(ERROR) << "the browser would not embed the surface";
      Finish(false);
      return;
    }
    printf("embedded as: %s\n", local_surface_id->ToString().c_str());
    local_surface_id_ = *local_surface_id;

    // One frame straight away so the surface activates without waiting on the
    // BeginFrame the hierarchy registration in Embed() just unblocked.
    Submit(viz::BeginFrameAck::CreateManualAckWithDamage());
    sink_->SetNeedsBeginFrame(true);

    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE,
        base::BindOnce(&SolidColorSubmitter::MaybeStartSampling,
                       base::Unretained(this)),
        kBeginFrameGrace);
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
    embedder_->SampleEmbeddedPixel(base::BindOnce(
        &SolidColorSubmitter::OnSampled, base::Unretained(this)));
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
        printf("NOT aggregated: the browser never drew the embedding layer\n");
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
  const gfx::Size size_;
  base::OnceCallback<void(bool)> done_;

  mojo::Remote<domicile::mojom::FrameSinkBroker> broker_;
  mojo::Remote<domicile::mojom::SpikeEmbedder> embedder_;
  mojo::Remote<viz::mojom::CompositorFrameSink> sink_;
  mojo::Receiver<viz::mojom::CompositorFrameSinkClient> client_receiver_{this};

  viz::FrameSinkId frame_sink_id_;
  viz::LocalSurfaceId local_surface_id_;
  viz::FrameTokenGenerator next_frame_token_;
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

gfx::Size ParseSize(const base::CommandLine& command_line) {
  constexpr gfx::Size kDefault(320, 240);
  if (!command_line.HasSwitch(kSizeSwitch)) {
    return kDefault;
  }
  const std::string value = command_line.GetSwitchValueASCII(kSizeSwitch);
  const size_t x = value.find('x');
  int width = 0;
  int height = 0;
  if (x == std::string::npos ||
      !base::StringToInt(value.substr(0, x), &width) ||
      !base::StringToInt(value.substr(x + 1), &height) || width <= 0 ||
      height <= 0) {
    LOG(ERROR) << "--size wants WxH; using the default";
    return kDefault;
  }
  return gfx::Size(width, height);
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
               << "=<path> [--color=AARRGGBB] [--size=WxH]";
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
      ParseColor(command_line), ParseSize(command_line),
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
