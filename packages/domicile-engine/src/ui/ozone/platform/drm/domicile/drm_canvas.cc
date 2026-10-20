// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_canvas.h"

#include <drm_fourcc.h>

#include <utility>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "third_party/skia/include/core/SkImageInfo.h"
#include "third_party/skia/include/core/SkPixmap.h"
#include "third_party/skia/include/core/SkSurface.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/gpu_fence_handle.h"
#include "ui/gfx/presentation_feedback.h"
#include "ui/gfx/vsync_provider.h"
#include "ui/ozone/platform/drm/gpu/drm_device.h"
#include "ui/ozone/platform/drm/gpu/drm_dumb_buffer.h"
#include "ui/ozone/platform/drm/gpu/drm_framebuffer.h"

namespace ui {

DrmScanoutBuffer::DrmScanoutBuffer() = default;
DrmScanoutBuffer::DrmScanoutBuffer(DrmScanoutBuffer&&) = default;
DrmScanoutBuffer& DrmScanoutBuffer::operator=(DrmScanoutBuffer&&) = default;
DrmScanoutBuffer::~DrmScanoutBuffer() = default;

std::optional<DrmScanoutBuffer> AllocateDrmScanoutBuffer(
    const scoped_refptr<DrmDevice>& drm,
    const gfx::Size& size) {
  DrmScanoutBuffer buffer;
  buffer.pixels = std::make_unique<DrmDumbBuffer>(drm);
  // N32 is BGRA in memory on little-endian, which is DRM's XRGB8888. Every
  // KMS driver takes XRGB8888; virtio-gpu takes little else.
  if (!buffer.pixels->Initialize(
          SkImageInfo::MakeN32(size.width(), size.height(),
                               kOpaque_SkAlphaType))) {
    LOG(ERROR) << "domicile: no " << size.ToString()
               << " dumb buffer to draw the desktop into";
    return std::nullopt;
  }

  DrmFramebuffer::AddFramebufferParams params;
  params.format = DRM_FORMAT_XRGB8888;
  params.width = size.width();
  params.height = size.height();
  params.num_planes = 1;
  params.handles[0] = buffer.pixels->GetHandle();
  params.strides[0] = buffer.pixels->stride();
  buffer.framebuffer = DrmFramebuffer::AddFramebuffer(drm, params);
  if (!buffer.framebuffer) {
    LOG(ERROR) << "domicile: the kernel refused a framebuffer for a "
               << size.ToString() << " dumb buffer";
    return std::nullopt;
  }
  return buffer;
}

DrmCanvas::DrmCanvas(std::unique_ptr<Display> display)
    : display_(std::move(display)) {}

DrmCanvas::~DrmCanvas() = default;

SkCanvas* DrmCanvas::GetCanvas() {
  return canvas_.get();
}

void DrmCanvas::ResizeCanvas(const gfx::Size& viewport_size, float scale) {
  frame_.allocPixels(SkImageInfo::MakeN32(
      viewport_size.width(), viewport_size.height(), kOpaque_SkAlphaType));
  frame_.eraseColor(SK_ColorBLACK);
  canvas_ = std::make_unique<SkCanvas>(frame_);
  AllocateBuffers();
}

void DrmCanvas::PresentCanvas(const gfx::Rect& damage) {
  if (reallocate_) {
    reallocate_ = false;
    AllocateBuffers();
  }

  const SkIRect damaged = SkIRect::MakeXYWH(damage.x(), damage.y(),
                                            damage.width(), damage.height());
  for (SkRegion& stale : stale_) {
    stale.op(damaged, SkRegion::kUnion_Op);
  }

  // A buffer the kernel refused leaves the screen on the last frame it got.
  // The refusal was logged where it happened.
  if (!buffers_[next_]) {
    return;
  }
  const DrmScanoutBuffer& buffer = *buffers_[next_];

  SkPixmap frame;
  CHECK(frame_.peekPixels(&frame));
  for (SkRegion::Iterator rect(stale_[next_]); !rect.done(); rect.next()) {
    SkPixmap part;
    CHECK(frame.extractSubset(&part, rect.rect()));
    buffer.pixels->surface()->writePixels(part, rect.rect().x(),
                                          rect.rect().y());
  }
  stale_[next_].setEmpty();

  flipping_ = true;
  display_->Flip(buffer.framebuffer,
                 base::BindOnce(&DrmCanvas::OnSubmitted, weak_factory_.GetWeakPtr()),
                 base::BindOnce(&DrmCanvas::OnPresented,
                                weak_factory_.GetWeakPtr()));
  next_ = 1 - next_;
}

std::unique_ptr<gfx::VSyncProvider> DrmCanvas::CreateVSyncProvider() {
  // Viz's own begin frames pace painting; a swap is acknowledged at the flip.
  return nullptr;
}

bool DrmCanvas::SupportsAsyncBufferSwap() const {
  return true;
}

void DrmCanvas::OnSwapBuffers(SwapBuffersCallback swap_ack_callback,
                              gfx::FrameData data) {
  if (!flipping_) {
    std::move(swap_ack_callback).Run(gfx::Size(frame_.width(), frame_.height()));
    return;
  }
  swap_ack_ = std::move(swap_ack_callback);
}

int DrmCanvas::MaxFramesPending() const {
  return 1;
}

void DrmCanvas::AllocateBuffers() {
  const gfx::Size size(frame_.width(), frame_.height());
  for (size_t index = 0; index < buffers_.size(); ++index) {
    buffers_[index] = display_->Allocate(size);
    stale_[index].setRect(SkIRect::MakeWH(size.width(), size.height()));
  }
  next_ = 0;
}

void DrmCanvas::OnSubmitted(gfx::SwapResult result,
                            gfx::GpuFenceHandle release_fence) {
  switch (result) {
    case gfx::SwapResult::SWAP_ACK:
    case gfx::SwapResult::SWAP_SKIPPED:
      return;
    case gfx::SwapResult::SWAP_NAK_RECREATE_BUFFERS:
      reallocate_ = true;
      return;
    case gfx::SwapResult::SWAP_FAILED:
      LOG(ERROR) << "domicile: a page flip of the desktop failed; the screen "
                    "keeps its last frame";
      return;
  }
}

void DrmCanvas::OnPresented(const gfx::PresentationFeedback& feedback) {
  flipping_ = false;
  if (swap_ack_) {
    std::move(swap_ack_).Run(gfx::Size(frame_.width(), frame_.height()));
  }
}

}  // namespace ui
