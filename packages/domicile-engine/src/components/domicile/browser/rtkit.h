// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_RTKIT_H_
#define COMPONENTS_DOMICILE_BROWSER_RTKIT_H_

#include <memory>

#include "base/process/process_handle.h"
#include "base/threading/platform_thread.h"

namespace dbus {
class MethodCall;
}

namespace domicile {

// rtkit's call that sets thread `thread_id` of process `process_id` to nice
// value `nice`.
std::unique_ptr<dbus::MethodCall> RtkitRaise(base::ProcessId process_id,
                                             base::PlatformThreadId thread_id,
                                             int nice);

// Asks rtkit to raise every thread that setpriority() refuses to raise, as it
// does without RLIMIT_NICE or CAP_SYS_NICE. Browser process only: the other
// processes' threads are raised from the browser.
//
// See docs/RUNNING-A-DESKTOP.md#thread-priorities in the Domicile repository.
void AskRtkitWhenTheLimitsRefuse();

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_RTKIT_H_
