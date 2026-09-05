// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "content/browser/domicile/domicile_spike_probe.h"

#include <cstdint>
#include <memory>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/functional/callback.h"
#include "base/no_destructor.h"
#include "build/build_config.h"
#include "components/viz/common/frame_sinks/copy_output_request.h"
#include "components/viz/common/frame_sinks/copy_output_result.h"
#include "content/public/browser/browser_thread.h"
#include "mojo/public/cpp/bindings/receiver_set.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/size.h"

#if defined(USE_AURA)
#include "ui/aura/env.h"
#include "ui/aura/window.h"
#include "ui/aura/window_tree_host.h"
#include "ui/compositor/compositor.h"
#include "ui/compositor/layer.h"
#endif

namespace content {
namespace {

// What every method here is built on: the browser window as viz drew it. An
// empty bitmap means there was no window, or nothing had been drawn yet.
using CapturedCallback = base::OnceCallback<void(const SkBitmap&)>;

class DomicileSpikeProbe : public domicile::mojom::SpikeProbe {
 public:
  void Bind(mojo::PendingReceiver<domicile::mojom::SpikeProbe> receiver) {
    receivers_.Add(this, std::move(receiver));
  }

 private:
  // domicile::mojom::SpikeProbe:
  void SampleWindowCenter(SampleWindowCenterCallback callback) override {
    Capture(base::BindOnce(
        [](SampleWindowCenterCallback callback, const SkBitmap& bitmap) {
          if (bitmap.drawsNothing()) {
            std::move(callback).Run(false, 0);
            return;
          }
          std::move(callback).Run(
              true, bitmap.getColor(bitmap.width() / 2, bitmap.height() / 2));
        },
        std::move(callback)));
  }

  void CaptureWindow(CaptureWindowCallback callback) override {
    Capture(base::BindOnce(
        [](CaptureWindowCallback callback, const SkBitmap& bitmap) {
          if (bitmap.drawsNothing()) {
            std::move(callback).Run(false, gfx::Size(), {});
            return;
          }
          std::vector<uint32_t> pixels;
          pixels.reserve(static_cast<size_t>(bitmap.width()) * bitmap.height());
          for (int y = 0; y < bitmap.height(); ++y) {
            for (int x = 0; x < bitmap.width(); ++x) {
              pixels.push_back(bitmap.getColor(x, y));
            }
          }
          std::move(callback).Run(
              true, gfx::Size(bitmap.width(), bitmap.height()),
              std::move(pixels));
        },
        std::move(callback)));
  }

  void SamplePixel(const gfx::Point& point,
                   SamplePixelCallback callback) override {
    Capture(base::BindOnce(
        [](gfx::Point point, SamplePixelCallback callback,
           const SkBitmap& bitmap) {
          // Out of bounds fails rather than clamping. A latency measurement
          // that silently polls the wrong pixel would report the wrong number
          // instead of stopping.
          if (bitmap.drawsNothing() || point.x() < 0 || point.y() < 0 ||
              point.x() >= bitmap.width() || point.y() >= bitmap.height()) {
            std::move(callback).Run(false, 0);
            return;
          }
          std::move(callback).Run(true, bitmap.getColor(point.x(), point.y()));
        },
        point, std::move(callback)));
  }

  // A copy request on the window's root layer is answered out of the display
  // compositor's draw, after the aggregator has resolved every SurfaceDrawQuad
  // in the tree — including the one the page's cc::SurfaceLayer produces for
  // the brokered surface. So a colour that comes back is a colour viz
  // aggregated, and if it is the producer's then the aggregation happened
  // through the page.
  static void Capture(CapturedCallback callback) {
#if defined(USE_AURA)
    ui::Layer* window = FirstWindowLayer();
    if (!window) {
      std::move(callback).Run(SkBitmap());
      return;
    }

    auto request = std::make_unique<viz::CopyOutputRequest>(
        viz::CopyOutputRequest::ResultFormat::RGBA,
        viz::CopyOutputRequest::ResultDestination::kSystemMemory,
        base::BindOnce(&DomicileSpikeProbe::OnCopied, std::move(callback)));
    window->RequestCopyOfOutput(std::move(request));
    if (ui::Compositor* compositor = window->GetCompositor()) {
      compositor->ScheduleFullRedraw();
    }
#else
    std::move(callback).Run(SkBitmap());
#endif
  }

  static void OnCopied(CapturedCallback callback,
                       std::unique_ptr<viz::CopyOutputResult> result) {
    if (!result || result->IsEmpty()) {
      std::move(callback).Run(SkBitmap());
      return;
    }
    viz::CopyOutputResult::ScopedSkBitmap scoped =
        result->ScopedAccessSkBitmap();
    std::move(callback).Run(scoped.bitmap());
  }

#if defined(USE_AURA)
  // The browser window's own root layer. Everything the page draws is under it,
  // which is what makes its pixels the page's to fill.
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
