// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "content/browser/domicile/domicile_spike_probe.h"

#include <cstdint>
#include <memory>
#include <utility>

#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "build/build_config.h"
#include "components/viz/common/frame_sinks/copy_output_request.h"
#include "components/viz/common/frame_sinks/copy_output_result.h"
#include "content/public/browser/browser_thread.h"
#include "mojo/public/cpp/bindings/receiver_set.h"
#include "third_party/skia/include/core/SkBitmap.h"

#if defined(USE_AURA)
#include "ui/aura/env.h"
#include "ui/aura/window.h"
#include "ui/aura/window_tree_host.h"
#include "ui/compositor/compositor.h"
#include "ui/compositor/layer.h"
#endif

namespace content {
namespace {

class DomicileSpikeProbe : public domicile::mojom::SpikeProbe {
 public:
  void Bind(mojo::PendingReceiver<domicile::mojom::SpikeProbe> receiver) {
    receivers_.Add(this, std::move(receiver));
  }

 private:
  // domicile::mojom::SpikeProbe:
  void SampleWindowCenter(SampleWindowCenterCallback callback) override {
#if defined(USE_AURA)
    ui::Layer* window = FirstWindowLayer();
    if (!window) {
      std::move(callback).Run(false, 0);
      return;
    }

    // A copy request on the window's root layer is answered out of the display
    // compositor's draw, after the aggregator has resolved every SurfaceDrawQuad
    // in the tree — including the one the page's cc::SurfaceLayer produces for
    // the brokered surface. So a colour that comes back is a colour viz
    // aggregated, and if it is the producer's then the aggregation happened
    // through the page.
    auto request = std::make_unique<viz::CopyOutputRequest>(
        viz::CopyOutputRequest::ResultFormat::RGBA,
        viz::CopyOutputRequest::ResultDestination::kSystemMemory,
        base::BindOnce(&DomicileSpikeProbe::OnPixelCopied,
                       std::move(callback)));
    window->RequestCopyOfOutput(std::move(request));
    if (ui::Compositor* compositor = window->GetCompositor()) {
      compositor->ScheduleFullRedraw();
    }
#else
    std::move(callback).Run(false, 0);
#endif
  }

  static void OnPixelCopied(SampleWindowCenterCallback callback,
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
  // The browser window's own root layer. Everything the page draws is under it,
  // which is what makes the centre pixel the page's to fill.
  static ui::Layer* FirstWindowLayer() {
    for (aura::WindowTreeHost* host :
         aura::Env::GetInstance()->window_tree_hosts()) {
      if (host->window() && host->window()->layer()) {
        return host->window()->layer();
      }
    }
    return nullptr;
  }
#endif

  mojo::ReceiverSet<domicile::mojom::SpikeProbe> receivers_;
};

}  // namespace

void BindDomicileSpikeProbe(
    mojo::PendingReceiver<domicile::mojom::SpikeProbe> receiver) {
  CHECK_CURRENTLY_ON(BrowserThread::UI);
  static base::NoDestructor<DomicileSpikeProbe> probe;
  probe->Bind(std::move(receiver));
}

}  // namespace content
