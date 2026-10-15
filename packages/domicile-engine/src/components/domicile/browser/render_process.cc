// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/render_process.h"

#include <string_view>

#include "base/notreached.h"
#include "base/process/kill.h"
#include "components/domicile/mojom/web_view_guest.mojom-shared.h"

namespace domicile {

// No default, so a new status fails to compile. The ChromeOS, Android and
// Windows statuses do not exist in this Linux-only build.
mojom::WebViewRenderProcess RenderProcessOf(base::TerminationStatus status) {
  switch (status) {
    case base::TERMINATION_STATUS_STILL_RUNNING:
      return mojom::WebViewRenderProcess::kRunning;
    case base::TERMINATION_STATUS_NORMAL_TERMINATION:
      return mojom::WebViewRenderProcess::kCleanExit;
    case base::TERMINATION_STATUS_ABNORMAL_TERMINATION:
      return mojom::WebViewRenderProcess::kAbnormalExit;
    case base::TERMINATION_STATUS_PROCESS_WAS_KILLED:
      return mojom::WebViewRenderProcess::kKilled;
    case base::TERMINATION_STATUS_PROCESS_CRASHED:
      return mojom::WebViewRenderProcess::kCrashed;
    case base::TERMINATION_STATUS_OOM:
      return mojom::WebViewRenderProcess::kOom;
    case base::TERMINATION_STATUS_LAUNCH_FAILED:
      return mojom::WebViewRenderProcess::kLaunchFailed;
    case base::TERMINATION_STATUS_EVICTED_FOR_MEMORY:
      return mojom::WebViewRenderProcess::kMemoryEviction;
    case base::TERMINATION_STATUS_MAX_ENUM:
      NOTREACHED();
  }
  NOTREACHED();
}

// The names must match the element's RenderProcessName and the SDK's
// WEBVIEW_RENDER_PROCESS_GONE_REASONS, in order.
// scripts/test-render-process-reasons-agree.sh checks this.
std::string_view RenderProcessName(mojom::WebViewRenderProcess state) {
  switch (state) {
    case mojom::WebViewRenderProcess::kRunning:
      return "";
    case mojom::WebViewRenderProcess::kCleanExit:
      return "clean-exit";
    case mojom::WebViewRenderProcess::kAbnormalExit:
      return "abnormal-exit";
    case mojom::WebViewRenderProcess::kKilled:
      return "killed";
    case mojom::WebViewRenderProcess::kCrashed:
      return "crashed";
    case mojom::WebViewRenderProcess::kOom:
      return "oom";
    case mojom::WebViewRenderProcess::kLaunchFailed:
      return "launch-failed";
    case mojom::WebViewRenderProcess::kMemoryEviction:
      return "memory-eviction";
  }
  NOTREACHED();
}

}  // namespace domicile
