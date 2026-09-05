// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// THROWAWAY. Steps 2 and 3 of the spike in docs/architecture/ENGINE-FORK.md.
//
// Runs a domicile::spike::SurfaceProducer — a viz client in a process the
// browser did not launch — and then asks the browser what colour it actually
// drew at the centre of its window. Exits 0 only if that colour is the one the
// producer submitted.
//
// In step 2 that answered "does viz aggregate frames from a producer that is
// not a renderer?", against a ui::LayerSurface in the browser's own window. In
// step 3 the embedder is a <canvas> in an ordinary web page instead, so the
// same exit code answers "does a page's cc::SurfaceLayer embed a surface the
// page did not allocate?".
//
// Step 4's measurement is domicile_css_parity, which reads CSS rather than one
// pixel. This stays because it is the evidence steps 2 and 3 are recorded on.
//
// packages/domicile-engine/scripts/spike.sh in the Domicile repository runs
// both halves and has the engine flags this needs.

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

// How long to wait for a page to embed us. The engine has to start, load a
// page, and the page has to call canvas.embedExternalSurface(); the producer
// may well win that race, and waiting here rather than failing keeps the
// ordering out of the harness.
constexpr base::TimeDelta kEmbedTimeout = base::Seconds(60);

// If no BeginFrame arrives, sample anyway: the first frame is submitted with a
// manual ack, so there is something to aggregate whether or not viz ever asks
// for more. Which of the two happened is the interesting part — hierarchy
// registration is what makes BeginFrames flow, and in step 3 the page is what
// asks for it — so it is reported either way.
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
