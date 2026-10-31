// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/rtkit.h"

#include <cstdint>
#include <utility>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/scoped_refptr.h"
#include "base/no_destructor.h"
#include "base/threading/thread.h"
#include "dbus/bus.h"
#include "dbus/message.h"
#include "dbus/object_path.h"
#include "dbus/object_proxy.h"

namespace domicile {

namespace {

constexpr char kRtkit[] = "org.freedesktop.RealtimeKit1";
constexpr char kRtkitPath[] = "/org/freedesktop/RealtimeKit1";
constexpr char kRaise[] = "MakeThreadHighPriorityWithPID";

// rtkit answers at once or not at all, and nothing waits on its answer.
constexpr int kTimeoutMs = 1000;

// The thread rtkit's calls are made on, and its bus. The calls block, so the
// thread whose raise was refused never waits on rtkit.
class RtkitThread {
 public:
  RtkitThread() : thread_("domicile-rtkit") { CHECK(thread_.Start()); }

  // Any thread.
  void Raise(base::ProcessId process_id,
             base::PlatformThreadId thread_id,
             int nice) {
    thread_.task_runner()->PostTask(
        FROM_HERE, base::BindOnce(&RtkitThread::RaiseHere,
                                  base::Unretained(this), process_id,
                                  thread_id, nice));
  }

 private:
  void RaiseHere(base::ProcessId process_id,
                 base::PlatformThreadId thread_id,
                 int nice) {
    if (!bus_) {
      dbus::Bus::Options options;
      options.bus_type = dbus::Bus::SYSTEM;
      options.connection_type = dbus::Bus::PRIVATE;
      bus_ = base::MakeRefCounted<dbus::Bus>(std::move(options));
    }
    std::unique_ptr<dbus::MethodCall> raise =
        RtkitRaise(process_id, thread_id, nice);
    auto answer =
        bus_->GetObjectProxy(kRtkit, dbus::ObjectPath(kRtkitPath))
            ->CallMethodAndBlock(raise.get(), kTimeoutMs);
    if (answer.has_value()) {
      return;
    }
    // Once loudly: without rtkit or the limits every raise is refused, and
    // the desktop still works.
    if (!warned_) {
      warned_ = true;
      LOG(WARNING) << "rtkit did not raise thread " << thread_id
                   << " of process " << process_id << " to nice " << nice
                   << " (" << answer.error().message()
                   << "), so it competes with other work. See "
                      "docs/RUNNING-A-DESKTOP.md#thread-priorities";
      return;
    }
    VLOG(1) << "rtkit did not raise thread " << thread_id << " of process "
            << process_id << " to nice " << nice << ": "
            << answer.error().message();
  }

  base::Thread thread_;
  scoped_refptr<dbus::Bus> bus_;
  bool warned_ = false;
};

RtkitThread& TheRtkitThread() {
  static base::NoDestructor<RtkitThread> rtkit;
  return *rtkit;
}

}  // namespace

std::unique_ptr<dbus::MethodCall> RtkitRaise(base::ProcessId process_id,
                                             base::PlatformThreadId thread_id,
                                             int nice) {
  auto raise = std::make_unique<dbus::MethodCall>(kRtkit, kRaise);
  dbus::MessageWriter writer(raise.get());
  writer.AppendUint64(static_cast<uint64_t>(process_id));
  writer.AppendUint64(static_cast<uint64_t>(thread_id));
  writer.AppendInt32(nice);
  return raise;
}

void AskRtkitWhenTheLimitsRefuse() {
  // Started here, on the browser's main thread, rather than by the first
  // refusal on whichever thread that is.
  TheRtkitThread();
  base::PlatformThreadLinux::SetRaiseRefusedCallback(
      [](base::ProcessId process_id, base::PlatformThreadId thread_id,
         int nice) { TheRtkitThread().Raise(process_id, thread_id, nice); });
}

}  // namespace domicile
