// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/render_process.h"

#include "base/process/kill.h"
#include "components/domicile/mojom/web_view_guest.mojom.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

using mojom::WebViewRenderProcess;

TEST(RenderProcessTest, EachWayAProcessEndsHasItsReason) {
  EXPECT_EQ(RenderProcessOf(base::TERMINATION_STATUS_NORMAL_TERMINATION),
            WebViewRenderProcess::kCleanExit);
  EXPECT_EQ(RenderProcessOf(base::TERMINATION_STATUS_ABNORMAL_TERMINATION),
            WebViewRenderProcess::kAbnormalExit);
  EXPECT_EQ(RenderProcessOf(base::TERMINATION_STATUS_PROCESS_WAS_KILLED),
            WebViewRenderProcess::kKilled);
  EXPECT_EQ(RenderProcessOf(base::TERMINATION_STATUS_PROCESS_CRASHED),
            WebViewRenderProcess::kCrashed);
  EXPECT_EQ(RenderProcessOf(base::TERMINATION_STATUS_OOM),
            WebViewRenderProcess::kOom);
  EXPECT_EQ(RenderProcessOf(base::TERMINATION_STATUS_LAUNCH_FAILED),
            WebViewRenderProcess::kLaunchFailed);
  EXPECT_EQ(RenderProcessOf(base::TERMINATION_STATUS_EVICTED_FOR_MEMORY),
            WebViewRenderProcess::kMemoryEviction);
}

TEST(RenderProcessTest, AProcessStillRunningIsRunning) {
  // WebContents reports this once a new renderer is up, as after a reload.
  EXPECT_EQ(RenderProcessOf(base::TERMINATION_STATUS_STILL_RUNNING),
            WebViewRenderProcess::kRunning);
}

TEST(RenderProcessTest, ARunningProcessHasNoName) {
  // `renderProcessGone` is empty while the page has a renderer.
  EXPECT_EQ(RenderProcessName(WebViewRenderProcess::kRunning), "");
  EXPECT_EQ(RenderProcessName(WebViewRenderProcess::kCrashed), "crashed");
  EXPECT_EQ(RenderProcessName(WebViewRenderProcess::kOom), "oom");
}

}  // namespace
}  // namespace domicile
