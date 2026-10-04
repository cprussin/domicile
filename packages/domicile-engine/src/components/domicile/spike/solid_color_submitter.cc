// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

// Spike: checks that viz draws frames from a producer the browser did not
// launch. Results are in
// docs/architecture/ENGINE-FORK-MEASUREMENTS.md#getting-a-surface-on-screen.
//
// Runs a domicile::spike::SurfaceProducer, then reads the color at the center
// of the browser's window. Exits 0 only if it is the color the producer
// submitted. The embedder is either a ui::LayerSurface in the browser window
// or a <canvas> in a web page.
//
// packages/domicile-engine/scripts/spike.sh runs it with the engine flags it
// needs.

#include <cinttypes>
#include <cstdint>
#include <cstdio>
#include <string>
#include <utility>

#include "base/at_exit.h"
#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/message_loop/message_pump_type.h"
#include "base/run_loop.h"
#include "base/task/single_thread_task_executor.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool/thread_pool_instance.h"
#include "base/threading/thread.h"
#include "base/time/time.h"
#include "components/domicile/spike/spike_color.h"
#include "components/domicile/spike/surface_producer.h"
#include "components/viz/common/surfaces/frame_sink_id.h"
#include "components/viz/common/surfaces/local_surface_id.h"
#include "mojo/core/embedder/embedder.h"
#include "mojo/core/embedder/scoped_ipc_support.h"
#include "mojo/public/cpp/platform/named_platform_channel.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/gfx/geometry/size.h"

namespace {

// Must match content/browser/domicile/domicile_frame_sink_broker.cc.
constexpr char kSocketSwitch[] = "domicile-broker-socket";
constexpr char kColorSwitch[] = "color";

// How long to wait for a page to embed the surface. The producer often starts
// before the page calls canvas.embedExternalSurface(), so waiting here keeps
// the harness from having to order them.
constexpr base::TimeDelta kEmbedTimeout = base::Seconds(60);

// If no BeginFrame arrives, sample anyway: the first frame is submitted with a
// manual ack, so there is something to aggregate. Whether BeginFrames flowed is
// reported because it shows that the page registered the surface hierarchy.
constexpr base::TimeDelta kBeginFrameGrace = base::Seconds(3);
constexpr int kSampleTries = 40;
constexpr base::TimeDelta kSampleInterval = base::Milliseconds(100);

class Step3Check {
 public:
  Step3Check(SkColor color, base::OnceCallback<void(bool)> done)
      : done_(std::move(done)),
        producer_(color,
                  base::BindRepeating(&Step3Check::OnEmbedded,
                                      base::Unretained(this)),
                  base::BindOnce(&Step3Check::OnLost, base::Unretained(this))) {
  }

  bool Connect(const mojo::NamedPlatformChannel::ServerName& socket) {
    return producer_.Connect(socket);
  }

  void Start() {
    producer_.Start(
        base::BindOnce(&Step3Check::OnBrokered, base::Unretained(this)));
  }

 private:
  void OnBrokered(const viz::FrameSinkId& frame_sink_id) {
    printf("brokered frame sink: %s\n", frame_sink_id.ToString().c_str());
    printf("waiting for a page to embed it...\n");
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE,
        base::BindOnce(&Step3Check::OnEmbedTimeout, base::Unretained(this)),
        kEmbedTimeout);
  }

  void OnEmbedded(const viz::LocalSurfaceId& local_surface_id,
                  const gfx::Size& size) {
    if (sampling_started_) {
      return;
    }
    printf("a page embedded us: %s at %s\n",
           local_surface_id.ToString().c_str(), size.ToString().c_str());
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE,
        base::BindOnce(&Step3Check::StartSampling, base::Unretained(this)),
        kBeginFrameGrace);
  }

  void OnEmbedTimeout() {
    if (producer_.embedded()) {
      return;
    }
    printf("NOT embedded: no page asked for this surface in %" PRId64 "s\n",
           kEmbedTimeout.InSeconds());
    Finish(false);
  }

  void StartSampling() {
    if (sampling_started_) {
      return;
    }
    sampling_started_ = true;
    if (producer_.begin_frames_seen() > 0) {
      printf("BeginFrames are flowing\n");
    } else {
      printf("no BeginFrames after %" PRId64 "s; sampling anyway\n",
             kBeginFrameGrace.InSeconds());
    }
    Sample();
  }

  void Sample() {
    producer_.probe()->SampleWindowCenter(
        base::BindOnce(&Step3Check::OnSampled, base::Unretained(this)));
  }

  void OnSampled(bool sampled, uint32_t argb) {
    if (sampled && domicile::spike::ColorsMatch(argb, producer_.color())) {
      printf("aggregated: drew %s, submitted %s\n",
             domicile::spike::ToHex(argb).c_str(),
             domicile::spike::ToHex(producer_.color()).c_str());
      Finish(true);
      return;
    }

    if (++sample_tries_ >= kSampleTries) {
      if (sampled) {
        printf("NOT aggregated: drew %s, submitted %s\n",
               domicile::spike::ToHex(argb).c_str(),
               domicile::spike::ToHex(producer_.color()).c_str());
      } else {
        printf("NOT aggregated: the browser never drew its window\n");
      }
      Finish(false);
      return;
    }

    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE,
        base::BindOnce(&Step3Check::Sample, base::Unretained(this)),
        kSampleInterval);
  }

  void OnLost(const std::string& why) {
    LOG(ERROR) << why;
    Finish(false);
  }

  void Finish(bool ok) {
    if (done_) {
      std::move(done_).Run(ok);
    }
  }

  base::OnceCallback<void(bool)> done_;
  domicile::spike::SurfaceProducer producer_;
  int sample_tries_ = 0;
  bool sampling_started_ = false;
};

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
  Step3Check check(
      domicile::spike::ParseColor(command_line, kColorSwitch,
                                  SkColorSetARGB(0xFF, 0xFF, 0x00, 0xFF)),
      base::BindOnce(
          [](bool* ok, base::OnceClosure quit, bool result) {
            *ok = result;
            std::move(quit).Run();
          },
          &ok, run_loop.QuitClosure()));

  if (!check.Connect(mojo::NamedPlatformChannel::ServerNameFromUTF8(socket))) {
    return 1;
  }
  check.Start();
  run_loop.Run();

  return ok ? 0 : 1;
}
