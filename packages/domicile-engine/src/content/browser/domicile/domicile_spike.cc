// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "content/browser/domicile/domicile_spike.h"

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <utility>

#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/process/process_handle.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "build/build_config.h"
#include "components/domicile/spike/mojom/spike_embedder.mojom.h"
#include "components/viz/common/frame_sinks/copy_output_request.h"
#include "components/viz/common/frame_sinks/copy_output_result.h"
#include "components/viz/common/surfaces/parent_local_surface_id_allocator.h"
#include "components/viz/common/surfaces/surface_id.h"
#include "content/browser/domicile/domicile_frame_sink_broker.h"
#include "content/public/browser/browser_thread.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/platform/named_platform_channel.h"
#include "mojo/public/cpp/system/invitation.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/gfx/geometry/rect.h"

#if defined(USE_AURA)
#include "cc/layers/deadline_policy.h"
#include "ui/aura/env.h"
#include "ui/aura/window.h"
#include "ui/aura/window_tree_host.h"
#include "ui/compositor/compositor.h"
#include "ui/compositor/layer_surface.h"
#endif

namespace content {
namespace {

// Must match components/domicile/spike/solid_color_submitter.cc.
constexpr char kSocketSwitch[] = "domicile-broker-socket";
// Integer, not string, and that is not a style choice. Under ipcz an
// invitation attachment is indexed by the first four bytes of its name read as
// a little-endian integer, and any name that is not exactly 4 or 8 bytes long
// lands on index 0 (mojo/core/ipcz_driver/invitation.cc, GetAttachmentIndex).
// So two string-named pipes on one invitation collide, and the second attach
// fails with MOJO_RESULT_ALREADY_EXISTS. Small integers, and at most
// Invitation::kMaxAttachments (7) of them.
constexpr uint64_t kBrokerPipeName = 0;
constexpr uint64_t kEmbedderPipeName = 1;

// Measurement switches, so the spike can answer "what is each piece for?"
// rather than only "does the whole thing work?".
constexpr char kSkipHierarchySwitch[] = "domicile-spike-skip-hierarchy";
constexpr char kSkipSurfaceLayerSwitch[] = "domicile-spike-skip-surface-layer";

// Where the embedding layer goes in the browser window, and what it shows
// before the producer's surface resolves. The fallback is deliberately a colour
// no producer would submit, so a sampled pixel distinguishes "viz drew the
// external process's frame" from "viz drew the gutter".
constexpr int kLayerOrigin = 40;
constexpr SkColor4f kFallbackColor = SkColors::kBlack;

// How long to wait for a browser window before giving up on embedding.
constexpr int kEmbedTries = 60;
constexpr base::TimeDelta kEmbedRetryInterval = base::Milliseconds(500);

// Stands in for the page until `<canvas>` can do this itself, which is step 3.
//
// Everything the real embedder will do, this does: it allocates the
// LocalSurfaceId (the embed_token in it is the capability the producer needs),
// it registers the producer's frame sink as a child of the compositor's so
// BeginFrames reach it, and it puts a cc::SurfaceLayer naming the SurfaceId
// into a layer tree. Here the layer tree is the browser's own UI rather than
// the page's, because that needs no Blink.
class DomicileSpike : public domicile::mojom::SpikeEmbedder {
 public:
  DomicileSpike() = default;

  DomicileSpike(const DomicileSpike&) = delete;
  DomicileSpike& operator=(const DomicileSpike&) = delete;

  ~DomicileSpike() override = default;

  void Start(const std::string& socket_path) {
    mojo::NamedPlatformChannel::Options options;
    options.server_name =
        mojo::NamedPlatformChannel::ServerNameFromUTF8(socket_path);
    mojo::NamedPlatformChannel channel(options);
    if (!channel.server_endpoint().is_valid()) {
      LOG(ERROR) << "domicile: could not listen on " << socket_path;
      return;
    }

    mojo::OutgoingInvitation invitation;
    GetDomicileFrameSinkBroker().Bind(
        mojo::PendingReceiver<domicile::mojom::FrameSinkBroker>(
            invitation.AttachMessagePipe(kBrokerPipeName)));
    receiver_.Bind(mojo::PendingReceiver<domicile::mojom::SpikeEmbedder>(
        invitation.AttachMessagePipe(kEmbedderPipeName)));

    // A real invitation, not mojo::IsolatedConnection: the broker's whole job
    // is forwarding the producer's CompositorFrameSink receiver on to the viz
    // process, and an isolated connection cannot carry a handle that far. See
    // ENGINE-FORK.md, "How the producer reaches the broker".
    //
    // The producer is not a child process, so there is no process handle to
    // give. On POSIX that costs nothing.
    mojo::OutgoingInvitation::Send(std::move(invitation),
                                   base::kNullProcessHandle,
                                   channel.TakeServerEndpoint());
    LOG(WARNING) << "domicile: frame sink broker listening on " << socket_path;
  }

 private:
  // domicile::mojom::SpikeEmbedder:
  void Embed(const viz::FrameSinkId& frame_sink_id,
             const gfx::Size& size,
             EmbedCallback callback) override {
    EmbedWhenThereIsAWindow(frame_sink_id, size, std::move(callback), 0);
  }

  void EmbedWhenThereIsAWindow(const viz::FrameSinkId& frame_sink_id,
                               const gfx::Size& size,
                               EmbedCallback callback,
                               int tries) {
#if defined(USE_AURA)
    // The producer is started by hand and may well win the race with the first
    // window. Waiting here rather than failing keeps that out of the producer.
    ui::Layer* parent = FirstWindowLayer();
    ui::Compositor* compositor = parent ? parent->GetCompositor() : nullptr;
    if (!parent || !compositor) {
      if (tries >= kEmbedTries) {
        LOG(ERROR) << "domicile: no window with a compositor to embed into";
        std::move(callback).Run(std::nullopt);
        return;
      }
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
          FROM_HERE,
          base::BindOnce(&DomicileSpike::EmbedWhenThereIsAWindow,
                         base::Unretained(this), frame_sink_id, size,
                         std::move(callback), tries + 1),
          kEmbedRetryInterval);
      return;
    }

    // Without this the sink accepts frames and viz never asks for any: the
    // hierarchy is what BeginFrames travel down. It is not what gets the
    // surface drawn — the SurfaceLayer below is.
    // --domicile-spike-skip-hierarchy is how that claim was measured rather
    // than assumed.
    if (!base::CommandLine::ForCurrentProcess()->HasSwitch(
            kSkipHierarchySwitch)) {
      compositor->AddChildFrameSink(frame_sink_id);
    }

    allocator_.GenerateId();
    const viz::LocalSurfaceId local_surface_id =
        allocator_.GetCurrentLocalSurfaceId();

    layer_ = std::make_unique<ui::LayerSurface>();
    layer_->SetBounds(
        gfx::Rect(kLayerOrigin, kLayerOrigin, size.width(), size.height()));
    layer_->SetFallbackBackgroundColor(kFallbackColor);
    // --domicile-spike-skip-surface-layer leaves a layer of the right size in
    // the right place that names no surface, which is the control: everything
    // the broker does, and nothing that embeds.
    if (!base::CommandLine::ForCurrentProcess()->HasSwitch(
            kSkipSurfaceLayerSwitch)) {
      layer_->SetShowSurface(viz::SurfaceId(frame_sink_id, local_surface_id),
                             size, cc::DeadlinePolicy::UseDefaultDeadline(),
                             /*stretch_content_to_fill_bounds=*/false);
    }
    layer_->SetVisible(true);
    parent->Add(layer_.get());
    parent->StackAtTop(layer_.get());
    compositor->ScheduleFullRedraw();

    std::move(callback).Run(local_surface_id);
#else
    std::move(callback).Run(std::nullopt);
#endif
  }

  void SampleEmbeddedPixel(SampleEmbeddedPixelCallback callback) override {
#if defined(USE_AURA)
    if (!layer_) {
      std::move(callback).Run(false, 0);
      return;
    }

    // A copy request on this layer is answered out of the display compositor's
    // draw, after the aggregator has resolved the SurfaceDrawQuad the
    // SurfaceLayer produces. So the colour that comes back is, by
    // construction, a colour viz aggregated — there is no path by which the
    // producer's own frame could reach it otherwise.
    auto request = std::make_unique<viz::CopyOutputRequest>(
        viz::CopyOutputRequest::ResultFormat::RGBA,
        viz::CopyOutputRequest::ResultDestination::kSystemMemory,
        base::BindOnce(&DomicileSpike::OnPixelCopied, std::move(callback)));
    layer_->RequestCopyOfOutput(std::move(request));
    if (ui::Compositor* compositor = layer_->GetCompositor()) {
      compositor->ScheduleFullRedraw();
    }
#else
    std::move(callback).Run(false, 0);
#endif
  }

  static void OnPixelCopied(SampleEmbeddedPixelCallback callback,
                            std::unique_ptr<viz::CopyOutputResult> result) {
    if (!result || result->IsEmpty()) {
      std::move(callback).Run(false, 0);
      return;
    }
    viz::CopyOutputResult::ScopedSkBitmap scoped =
        result->ScopedAccessSkBitmap();
    const SkBitmap bitmap = scoped.bitmap();
    if (bitmap.drawsNothing()) {
      std::move(callback).Run(false, 0);
      return;
    }
    std::move(callback).Run(
        true, bitmap.getColor(bitmap.width() / 2, bitmap.height() / 2));
  }

#if defined(USE_AURA)
  // The browser window's own root layer, not a tab's. A tab needs a renderer
  // and a navigation; a window needs neither, and the layer tree under it is
  // the one the display compositor draws either way.
  static ui::Layer* FirstWindowLayer() {
    for (aura::WindowTreeHost* host :
         aura::Env::GetInstance()->window_tree_hosts()) {
      if (host->window() && host->window()->layer()) {
        return host->window()->layer();
      }
    }
    return nullptr;
  }

  std::unique_ptr<ui::LayerSurface> layer_;
#endif

  viz::ParentLocalSurfaceIdAllocator allocator_;
  mojo::Receiver<domicile::mojom::SpikeEmbedder> receiver_{this};
};

}  // namespace

void MaybeStartDomicileSpike() {
  CHECK_CURRENTLY_ON(BrowserThread::UI);
  const base::CommandLine& command_line =
      *base::CommandLine::ForCurrentProcess();
  if (!command_line.HasSwitch(kSocketSwitch)) {
    return;
  }
  static base::NoDestructor<DomicileSpike> spike;
  spike->Start(command_line.GetSwitchValueASCII(kSocketSwitch));
}

}  // namespace content
