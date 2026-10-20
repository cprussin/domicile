// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_CANVAS_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_CANVAS_H_

#include <array>
#include <memory>
#include <optional>

#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "third_party/skia/include/core/SkCanvas.h"
#include "third_party/skia/include/core/SkRegion.h"
#include "ui/gfx/geometry/size.h"
#include "ui/gfx/swap_result.h"
#include "ui/ozone/public/surface_ozone_canvas.h"
#include "ui/ozone/public/swap_completion_callback.h"

namespace ui {

class DrmDevice;
class DrmDumbBuffer;
class DrmFramebuffer;

// A dumb buffer the display can scan out: its mapped pixels and its
// framebuffer.
struct DrmScanoutBuffer {
  DrmScanoutBuffer();
  DrmScanoutBuffer(DrmScanoutBuffer&&);
  DrmScanoutBuffer& operator=(DrmScanoutBuffer&&);
  ~DrmScanoutBuffer();

  std::unique_ptr<DrmDumbBuffer> pixels;
  scoped_refptr<DrmFramebuffer> framebuffer;
};

// Allocates an XRGB8888 dumb buffer of `size` on `drm` and adds its
// framebuffer. Nullopt, logged, if the kernel refuses either.
std::optional<DrmScanoutBuffer> AllocateDrmScanoutBuffer(
    const scoped_refptr<DrmDevice>& drm,
    const gfx::Size& size);

// A window's software output, for a GPU process that composites on the CPU:
// 2D virtio-gpu, Hyper-V, simpledrm, vkms. See
// docs/architecture/A-DESKTOP-ON-A-TTY.md#software-output.
//
// Viz paints into a frame in memory. Each present copies what changed into
// one of two dumb buffers and flips to it. The dumb buffers are only written:
// on real hardware they are write-combined and slow to read.
//
// A buffer misses every frame presented while the other was in use, so each
// keeps the region it is stale by, and a present copies that region too.
//
// A swap is acknowledged when its flip lands, so viz paints the next frame
// into the buffer the display just let go of.
class DrmCanvas : public SurfaceOzoneCanvas {
 public:
  // The window's side of the DRM thread.
  class Display {
   public:
    virtual ~Display() = default;

    // A buffer of `size` on the device driving the window.
    virtual std::optional<DrmScanoutBuffer> Allocate(const gfx::Size& size) = 0;

    // Flips the window's CRTC to `framebuffer`. `presented` runs once the
    // flip lands, or at once if it never will.
    virtual void Flip(scoped_refptr<DrmFramebuffer> framebuffer,
                      SwapCompletionOnceCallback submitted,
                      PresentationOnceCallback presented) = 0;
  };

  explicit DrmCanvas(std::unique_ptr<Display> display);

  DrmCanvas(const DrmCanvas&) = delete;
  DrmCanvas& operator=(const DrmCanvas&) = delete;

  ~DrmCanvas() override;

  // SurfaceOzoneCanvas:
  SkCanvas* GetCanvas() override;
  void ResizeCanvas(const gfx::Size& viewport_size, float scale) override;
  void PresentCanvas(const gfx::Rect& damage) override;
  std::unique_ptr<gfx::VSyncProvider> CreateVSyncProvider() override;
  bool SupportsAsyncBufferSwap() const override;
  void OnSwapBuffers(SwapBuffersCallback swap_ack_callback,
                     gfx::FrameData data) override;
  int MaxFramesPending() const override;

 private:
  // Allocates both buffers at the frame's size, each stale by all of it.
  void AllocateBuffers();

  void OnSubmitted(gfx::SwapResult result, gfx::GpuFenceHandle release_fence);
  void OnPresented(const gfx::PresentationFeedback& feedback);

  const std::unique_ptr<Display> display_;

  // What viz paints into. Holds the latest frame in full.
  SkBitmap frame_;
  std::unique_ptr<SkCanvas> canvas_;

  std::array<std::optional<DrmScanoutBuffer>, 2> buffers_;
  // What each buffer lacks of `frame_`.
  std::array<SkRegion, 2> stale_;
  // The buffer the next present copies into.
  size_t next_ = 0;

  // Set when a flip says the window's device changed.
  bool reallocate_ = false;
  bool flipping_ = false;
  SwapBuffersCallback swap_ack_;

  // A flip can land after the window is gone.
  base::WeakPtrFactory<DrmCanvas> weak_factory_{this};
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_CANVAS_H_
