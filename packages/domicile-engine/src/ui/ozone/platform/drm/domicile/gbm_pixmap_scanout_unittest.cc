// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include <drm_fourcc.h>
#include <gbm.h>

#include <string>

#include "base/logging.h"
#include "base/memory/scoped_refptr.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "ui/gfx/geometry/size.h"
#include "ui/gfx/gpu_fence_handle.h"
#include "ui/gfx/linux/test/mock_gbm_device.h"
#include "ui/gfx/native_ui_types.h"
#include "ui/gfx/overlay_plane_data.h"
#include "ui/ozone/platform/drm/gpu/gbm_pixmap.h"

namespace ui {
namespace {

constexpr gfx::Size kSize{64, 64};

int g_errors = 0;

bool CountErrors(int severity,
                 const char* file,
                 int line,
                 size_t message_start,
                 const std::string& message) {
  if (severity == logging::LOGGING_ERROR) {
    ++g_errors;
  }
  return true;
}

// Schedules `flags`' buffer twice and returns the errors logged. The pixmap has
// no surface factory and no framebuffer, as `DrmThread` makes for a buffer
// without `GBM_BO_USE_SCANOUT`, so queuing a plane would crash.
int ErrorsSchedulingTwice(uint32_t flags) {
  MockGbmDevice device;
  auto pixmap = base::MakeRefCounted<GbmPixmap>(
      /*surface_manager=*/nullptr,
      device.CreateBuffer(DRM_FORMAT_ARGB8888, kSize, flags),
      /*framebuffer=*/nullptr);
  g_errors = 0;
  const logging::LogMessageHandlerFunction previous =
      logging::GetLogMessageHandler();
  logging::SetLogMessageHandler(&CountErrors);
  for (int frame = 0; frame < 2; ++frame) {
    EXPECT_TRUE(pixmap->ScheduleOverlayPlane(gfx::kNullAcceleratedWidget,
                                             gfx::OverlayPlaneData(),
                                             gfx::GpuFenceHandle()));
  }
  logging::SetLogMessageHandler(previous);
  return g_errors;
}

TEST(GbmPixmapScanoutTest, ABufferDisplayCannotReadIsSkippedAndLoggedOnce) {
  EXPECT_EQ(ErrorsSchedulingTwice(GBM_BO_USE_RENDERING), 1);
}

TEST(GbmPixmapScanoutTest, AScanoutBufferLogsNothing) {
  EXPECT_EQ(ErrorsSchedulingTwice(GBM_BO_USE_SCANOUT), 0);
}

}  // namespace
}  // namespace ui
