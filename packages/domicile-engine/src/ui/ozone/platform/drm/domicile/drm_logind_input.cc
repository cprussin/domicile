// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_logind_input.h"

#include <fcntl.h>

#include <optional>
#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/location.h"
#include "base/logging.h"
#include "base/posix/eintr_wrapper.h"
#include "base/synchronization/waitable_event.h"
#include "base/task/sequenced_task_runner.h"
// Needed for the upcast to `scoped_refptr<base::SequencedTaskRunner>` in
// `Bus::Options`; other headers only forward-declare it.
#include "base/task/single_thread_task_runner.h"
#include "base/task/single_thread_task_runner_thread_mode.h"
#include "base/task/task_traits.h"
#include "base/task/thread_pool.h"
#include "base/types/expected.h"
#include "dbus/error.h"
#include "dbus/object_path.h"

namespace ui {

namespace {

constexpr char kLogind[] = "org.freedesktop.login1";
constexpr char kManagerPath[] = "/org/freedesktop/login1";
constexpr char kManagerInterface[] = "org.freedesktop.login1.Manager";
constexpr char kSessionInterface[] = "org.freedesktop.login1.Session";

constexpr char kGetSessionByPID[] = "GetSessionByPID";
constexpr char kTakeControl[] = "TakeControl";
constexpr char kReleaseControl[] = "ReleaseControl";
constexpr char kTakeDevice[] = "TakeDevice";
constexpr char kReleaseDevice[] = "ReleaseDevice";
constexpr char kPauseDeviceComplete[] = "PauseDeviceComplete";

constexpr char kSignalPauseDevice[] = "PauseDevice";
constexpr char kSignalResumeDevice[] = "ResumeDevice";

// The session's `Active` property. `DrmVtSwitcher` reads it too; see the
// header for why the subscription is separate.
constexpr char kPropertiesInterface[] = "org.freedesktop.DBus.Properties";
constexpr char kPropertiesGet[] = "Get";
constexpr char kPropertiesChanged[] = "PropertiesChanged";
constexpr char kActive[] = "Active";

// Explains a failure to take the session and how to fix it, for the fatal
// log.
constexpr char kNoSession[] =
    "Domicile takes every keyboard and mouse from logind's "
    "org.freedesktop.login1.Session, because no ACL covers an input device "
    "and the alternative -- the `input` group -- is a standing keyboard grant "
    "to every process this user runs. Start Domicile from a logind session on "
    "a tty of its own (a plain `login` on a free VT is one), and stop whatever "
    "else holds control of that session: logind gives TakeControl to one "
    "process at a time, so a display manager or another compositor still "
    "running on this VT is enough to refuse it.";

// Reads the major and minor that start every logind device call and signal.
DeviceNumber ReadDeviceNumber(dbus::MessageReader* reader) {
  DeviceNumber number;
  if (!reader->PopUint32(&number.major) || !reader->PopUint32(&number.minor)) {
    LOG(FATAL) << "logind sent a device message with no device in it";
  }
  return number;
}

void WriteDeviceNumber(dbus::MethodCall* call, DeviceNumber number) {
  dbus::MessageWriter writer(call);
  writer.AppendUint32(number.major);
  writer.AppendUint32(number.minor);
}

}  // namespace

DrmLogindInput::DrmLogindInput()
    : devices_(base::BindRepeating(&DrmLogindInput::ReleaseDevice,
                                   base::Unretained(this)),
               base::BindRepeating(&DrmLogindInput::ReopenDevice,
                                   base::Unretained(this))) {
  dbus::Bus::Options options;
  options.bus_type = dbus::Bus::SYSTEM;
  options.connection_type = dbus::Bus::PRIVATE;
  // A thread-pool worker has the `FileDescriptorWatcher` the bus needs, which
  // the evdev thread lacks. The browser's shared bus has the UI thread as its
  // origin, so it is not reused.
  //
  // `DEDICATED`, not `SHARED`: the blocking calls here hold the thread until
  // logind answers. On a shared thread, a console switch's ~45 calls would
  // delay `DrmVtSwitcher`'s `PropertiesChanged`, and the GPU process would
  // crash on the page-flip watchdog. See
  // docs/TTY-SESSION.md#the-d-bus-thread.
  options.dbus_task_runner = base::ThreadPool::CreateSingleThreadTaskRunner(
      {base::MayBlock(), base::TaskPriority::USER_BLOCKING},
      base::SingleThreadTaskRunnerThreadMode::DEDICATED);
  bus_ = base::MakeRefCounted<dbus::Bus>(std::move(options));

  dbus::ObjectProxy* manager =
      bus_->GetObjectProxy(kLogind, dbus::ObjectPath(kManagerPath));
  dbus::MethodCall find_session(kManagerInterface, kGetSessionByPID);
  dbus::MessageWriter writer(&find_session);
  // Zero means the caller, resolved from D-Bus credentials, so this needs
  // neither `XDG_SESSION_ID` nor a namespace-safe pid.
  writer.AppendUint32(0);

  std::unique_ptr<dbus::Response> found = CallAndBlock(manager, &find_session);
  if (!found) {
    LOG(FATAL) << "logind does not know of a session for this process. "
               << kNoSession;
  }

  dbus::MessageReader reader(found.get());
  dbus::ObjectPath session_path;
  if (!reader.PopObjectPath(&session_path)) {
    LOG(FATAL) << "logind answered " << kGetSessionByPID
               << " with something that is not a session";
  }
  session_ = bus_->GetObjectProxy(kLogind, session_path);

  // Subscribe before taking control, which starts device signals. An
  // unanswered `PauseDevice` stalls the console switch until logind's timeout,
  // and a missed `Active` change leaves revoked devices dead.
  if (!ConnectAndBlock(kSessionInterface, kSignalPauseDevice,
                       base::BindRepeating(&DrmLogindInput::OnPauseDevice,
                                           base::Unretained(this))) ||
      !ConnectAndBlock(kSessionInterface, kSignalResumeDevice,
                       base::BindRepeating(&DrmLogindInput::OnResumeDevice,
                                           base::Unretained(this))) ||
      !ConnectAndBlock(kPropertiesInterface, kPropertiesChanged,
                       base::BindRepeating(&DrmLogindInput::OnPropertiesChanged,
                                           base::Unretained(this)))) {
    LOG(FATAL) << "cannot follow logind's device signals on "
               << session_path.value()
               << ", so a console switch would leave this session holding "
               << "every keyboard it was given, revoked and with no way back";
  }

  dbus::MethodCall take_control(kSessionInterface, kTakeControl);
  dbus::MessageWriter control_writer(&take_control);
  // Not forced, so we never take devices from another process that thinks it
  // owns the session.
  control_writer.AppendBool(false);
  if (!CallAndBlock(session_, &take_control)) {
    LOG(FATAL) << "logind refused control of session " << session_path.value()
               << ". " << kNoSession;
  }
}

DrmLogindInput::~DrmLogindInput() {
  // Release now: `devices_`' destructor runs after the bus shuts down below.
  devices_.Release();

  dbus::MethodCall release_control(kSessionInterface, kReleaseControl);
  if (!CallAndBlock(session_, &release_control)) {
    LOG(ERROR) << "logind refused to take back control of this session";
  }

  session_ = nullptr;
  bus_->ShutdownOnDBusThreadAndBlock();
}

base::ScopedFD DrmLogindInput::OpenDeviceFd(
    const OpenInputDeviceParams& params) {
  // A reopen after `ResumeDevice` uses the parked descriptor, since
  // `TakeDevice` refuses a held device. Ordinary opens find nothing parked.
  base::ScopedFD resumed = devices_.Resumed(params.path);
  if (resumed.is_valid()) {
    VLOG(1) << "domicile: " << params.path.value()
            << " is opening on the descriptor a resume left for it";
    return resumed;
  }

  VLOG(2) << "domicile: asking logind for " << params.path.value();

  const std::optional<DeviceNumber> number = NumberOfDevice(params.path);
  if (!number.has_value()) {
    return base::ScopedFD();
  }

  // At most two tries. An inactive reply is normally fixed by the next
  // `Active` change, but if the session is already active no change will
  // come, so check the session and retry once.
  for (int attempt = 0; attempt < 2; ++attempt) {
    // Release first: `TakeDevice` refuses a held device ("Device is taken").
    // A no-op on a first open.
    devices_.GiveBack(*number);

    dbus::MethodCall take_device(kSessionInterface, kTakeDevice);
    WriteDeviceNumber(&take_device, *number);
    std::unique_ptr<dbus::Response> taken =
        CallAndBlock(session_, &take_device);
    if (!taken) {
      LOG(ERROR) << "logind refused device " << number->major << ":"
                 << number->minor << " for " << params.path.value();
      return base::ScopedFD();
    }

    dbus::MessageReader reader(taken.get());
    base::ScopedFD fd;
    if (!reader.PopFileDescriptor(&fd)) {
      LOG(ERROR) << "logind answered " << kTakeDevice << " for "
                 << params.path.value() << " without a descriptor";
      return base::ScopedFD();
    }

    // The reply is `hb`, where `b` is `inactive`. For an inactive session
    // logind returns an already-revoked descriptor.
    bool inactive = false;
    if (!reader.PopBool(&inactive)) {
      LOG(FATAL) << "logind answered " << kTakeDevice << " for "
                 << params.path.value()
                 << " without saying whether the device is live";
    }

    if (!inactive) {
      // logind opened this descriptor, so set non-blocking here. A blocking
      // read would stall every input device.
      if (HANDLE_EINTR(fcntl(fd.get(), F_SETFL, O_NONBLOCK)) < 0) {
        PLOG(ERROR) << "cannot make " << params.path.value()
                    << " non-blocking";
        return base::ScopedFD();
      }

      devices_.Take(*number, params.id, params.path, DeviceLiveness::kLive);
      return fd;
    }

    // Record it as revoked: logind still holds it for us, and the retry's
    // `GiveBack` must find it. The descriptor is dropped.
    devices_.Take(*number, params.id, params.path, DeviceLiveness::kRevoked);

    // If the session is active, the reply was stale and no `Active` change
    // will fix it, so retry. Otherwise activation reclaims the device.
    if (attempt == 0 && SessionIsActive()) {
      LOG(ERROR) << "logind handed over " << params.path.value() << " ("
                 << number->major << ":" << number->minor
                 << ") revoked while also saying this session is active; "
                    "taking it again, because no Active edge will arrive to "
                    "do it later";
      continue;
    }

    // Not an error: every switch away lands here once per device.
    VLOG(1) << "domicile: logind handed over " << params.path.value() << " ("
            << number->major << ":" << number->minor
            << ") revoked, because this session is not the one in front of "
               "the user; taking it again when the session goes Active";
    return base::ScopedFD();
  }

  // Both tries were inactive while the session is active; give up.
  LOG(ERROR) << "logind kept handing over " << params.path.value()
             << " revoked while saying this session is active, so this device "
                "stays dead. `loginctl session-status` names what else holds "
                "the session.";
  return base::ScopedFD();
}

void DrmLogindInput::ReopenDevice(int id, const base::FilePath& path) {
  // The factory owns this opener and sets the callback after construction.
  reopen_device().Run(id, path);
}

std::unique_ptr<dbus::Response> DrmLogindInput::CallAndBlock(
    dbus::ObjectProxy* proxy,
    dbus::MethodCall* call) {
  std::unique_ptr<dbus::Response> response;
  base::WaitableEvent answered;

  // Unretained is safe: the wait below outlives the task.
  bus_->GetDBusTaskRunner()->PostTask(
      FROM_HERE,
      base::BindOnce(
          [](dbus::ObjectProxy* proxy, dbus::MethodCall* call,
             std::unique_ptr<dbus::Response>* response,
             base::WaitableEvent* answered) {
            auto result = proxy->CallMethodAndBlock(
                call, dbus::ObjectProxy::TIMEOUT_USE_DEFAULT);
            if (result.has_value()) {
              *response = std::move(result.value());
            } else {
              LOG(ERROR) << "logind refused " << call->GetMember() << ": "
                         << result.error().name() << ": "
                         << result.error().message();
            }
            answered->Signal();
          },
          base::Unretained(proxy), base::Unretained(call),
          base::Unretained(&response), base::Unretained(&answered)));

  answered.Wait();
  return response;
}

bool DrmLogindInput::ConnectAndBlock(
    const std::string& interface,
    const std::string& signal,
    dbus::ObjectProxy::SignalCallback callback) {
  bool connected = false;
  base::WaitableEvent done;

  bus_->GetDBusTaskRunner()->PostTask(
      FROM_HERE,
      base::BindOnce(
          [](dbus::ObjectProxy* session, const std::string& interface,
             const std::string& signal,
             dbus::ObjectProxy::SignalCallback callback, bool* connected,
             base::WaitableEvent* done) {
            *connected = session->ConnectToSignalAndBlock(interface, signal,
                                                          std::move(callback));
            done->Signal();
          },
          base::Unretained(session_.get()), interface, signal,
          std::move(callback), base::Unretained(&connected),
          base::Unretained(&done)));

  done.Wait();
  return connected;
}

void DrmLogindInput::OnPauseDevice(dbus::Signal* signal) {
  dbus::MessageReader reader(signal);
  const DeviceNumber number = ReadDeviceNumber(&reader);
  std::string type;
  if (!reader.PopString(&type)) {
    LOG(FATAL) << "logind sent a " << kSignalPauseDevice << " with no type";
  }

  switch (devices_.Pause(number, type)) {
    case PauseAnswer::kNothingToSay:
      return;

    case PauseAnswer::kDeviceIsRevoked:
      // Logged so a loss of all input is visible. Verbose, because every
      // switch away sends one per device.
      VLOG(1) << "domicile: logind force-paused input device " << number.major
              << ":" << number.minor
              << "; taking it back when the session goes Active";
      return;

    case PauseAnswer::kCompleteIt:
      break;
  }

  // Only seats without VTs reach this. Blocking in a signal callback is safe:
  // signals run on the evdev thread and the call runs on the D-Bus thread.
  dbus::MethodCall complete(kSessionInterface, kPauseDeviceComplete);
  WriteDeviceNumber(&complete, number);
  if (!CallAndBlock(session_, &complete)) {
    LOG(ERROR) << "logind would not take " << kPauseDeviceComplete << " for "
               << number.major << ":" << number.minor
               << ", so the console switch waits for its own timeout";
  }
}

void DrmLogindInput::OnResumeDevice(dbus::Signal* signal) {
  dbus::MessageReader reader(signal);
  const DeviceNumber number = ReadDeviceNumber(&reader);
  base::ScopedFD fd;
  if (!reader.PopFileDescriptor(&fd)) {
    LOG(FATAL) << "logind sent a " << kSignalResumeDevice
               << " with no descriptor";
  }

  devices_.Resume(number, std::move(fd));
}

void DrmLogindInput::OnPropertiesChanged(dbus::Signal*) {
  // Query `Active` instead of parsing the signal, which may report it only as
  // invalidated. See `SessionIsActive`.
  const bool active = SessionIsActive();

  // Log both outcomes, so a run with no input shows whether this fired.
  VLOG(1) << "domicile: logind changed a session property; this session is "
          << (active ? "in front of the user" : "not in front of the user");

  if (!active) {
    return;
  }

  // `Reclaim` logs its own count.
  devices_.Reclaim();
}

bool DrmLogindInput::SessionIsActive() {
  dbus::MethodCall get(kPropertiesInterface, kPropertiesGet);
  dbus::MessageWriter writer(&get);
  writer.AppendString(kSessionInterface);
  writer.AppendString(kActive);

  std::unique_ptr<dbus::Response> answered = CallAndBlock(session_, &get);
  if (!answered) {
    // Assume inactive; the next `PropertiesChanged` asks again.
    LOG(ERROR) << "logind would not say whether this session is active, so "
                  "any input device it has revoked stays revoked until the "
                  "next time it says so";
    return false;
  }

  dbus::MessageReader reader(answered.get());
  bool active = false;
  if (!reader.PopVariantOfBool(&active)) {
    LOG(FATAL) << "logind answered " << kActive
               << " with something that is not a boolean";
  }
  return active;
}

bool DrmLogindInput::ReleaseDevice(DeviceNumber number) {
  dbus::MethodCall release(kSessionInterface, kReleaseDevice);
  WriteDeviceNumber(&release, number);
  return CallAndBlock(session_, &release) != nullptr;
}

}  // namespace ui
