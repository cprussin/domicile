// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_sleep.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/single_thread_task_runner_thread_mode.h"
#include "base/task/task_traits.h"
#include "base/task/thread_pool.h"
#include "dbus/object_path.h"
#include "dbus/object_proxy.h"
#include "ui/ozone/platform/drm/domicile/drm_modeset.h"

namespace ui {

namespace {

constexpr char kLogind[] = "org.freedesktop.login1";
constexpr char kManagerPath[] = "/org/freedesktop/login1";
constexpr char kManagerInterface[] = "org.freedesktop.login1.Manager";
constexpr char kPrepareForSleep[] = "PrepareForSleep";

}  // namespace

bool SleepEnded(dbus::Signal* signal) {
  dbus::MessageReader reader(signal);
  bool start = false;
  if (!reader.PopBool(&start)) {
    LOG(FATAL) << "logind answered " << kPrepareForSleep
               << " with something that is not a boolean";
  }

  return !start;
}

DrmSleep::DrmSleep(DrmModeset* modeset) : modeset_(modeset) {
  dbus::Bus::Options options;
  options.bus_type = dbus::Bus::SYSTEM;
  options.connection_type = dbus::Bus::PRIVATE;
  // Same setup as `DrmVtSwitcher`. The bus runs on a dedicated worker, which
  // installs the `FileDescriptorWatcher` it needs; the origin thread stays the
  // UI thread, where `DrmModeset` lives. Dedicated, because a shared thread
  // could not read this socket while `DrmLogindInput` waits on logind.
  options.dbus_task_runner = base::ThreadPool::CreateSingleThreadTaskRunner(
      {base::MayBlock(), base::TaskPriority::USER_BLOCKING},
      base::SingleThreadTaskRunnerThreadMode::DEDICATED);
  bus_ = base::MakeRefCounted<dbus::Bus>(std::move(options));

  bus_->GetObjectProxy(kLogind, dbus::ObjectPath(kManagerPath))
      ->ConnectToSignal(kManagerInterface, kPrepareForSleep,
                        base::BindRepeating(&DrmSleep::OnPrepareForSleep,
                                            weak_factory_.GetWeakPtr()),
                        base::BindOnce(&DrmSleep::OnSubscribed,
                                       weak_factory_.GetWeakPtr()));
}

DrmSleep::~DrmSleep() {
  // Blocking is allowed here: this runs during ozone platform shutdown, where
  // the browser closes its own buses the same way.
  bus_->ShutdownOnDBusThreadAndBlock();
}

void DrmSleep::OnPrepareForSleep(dbus::Signal* signal) {
  if (!SleepEnded(signal)) {
    // Nothing to do before sleep. See the header.
    VLOG(1) << "domicile: the machine is going to sleep";
    return;
  }

  VLOG(1) << "domicile: the machine is awake; lighting the screens again";
  modeset_->Relight();
}

void DrmSleep::OnSubscribed(const std::string& interface,
                            const std::string& signal,
                            bool connected) {
  if (!connected) {
    LOG(FATAL) << "cannot follow " << interface << "." << signal
               << ", so closing this machine's lid would leave Domicile with "
                  "no way to light its screens again";
  }
  VLOG(1) << "domicile: the screens follow the machine to sleep and back";
}

}  // namespace ui
