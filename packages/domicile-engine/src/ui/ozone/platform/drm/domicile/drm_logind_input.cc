// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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
// NOT JUST `..._thread_mode.h`. `CreateSingleThreadTaskRunner` answers a
// `scoped_refptr<base::SingleThreadTaskRunner>` and `Bus::Options` takes a
// `scoped_refptr<base::SequencedTaskRunner>`; the upcast between the two needs
// the DERIVED class complete, and every header that would otherwise reach here
// -- `dbus/bus.h`, `base/task/sequenced_task_runner.h` -- only forward-declares
// it.
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

// What a session that could not be taken leaves the desktop as, and what to do
// about it. Named rather than described, because the machine this fails on is
// the one with nothing to read the message with.
constexpr char kNoSession[] =
    "Domicile takes every keyboard and mouse from logind's "
    "org.freedesktop.login1.Session, because no ACL covers an input device "
    "and the alternative -- the `input` group -- is a standing keyboard grant "
    "to every process this user runs. Start Domicile from a logind session on "
    "a tty of its own (a plain `login` on a free VT is one), and stop whatever "
    "else holds control of that session: logind gives TakeControl to one "
    "process at a time, so a display manager or another compositor still "
    "running on this VT is enough to refuse it.";

// The two numbers every one of logind's device calls and signals starts with.
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
  // The same recipe `dbus_thread_linux::CreateSharedBus` uses, and for the
  // same reason: a thread-pool worker installs a `FileDescriptorWatcher` for
  // the scope tasks run in (`base/task/thread_pool/worker_thread.cc`), which
  // is what the bus needs to watch its socket and what the evdev thread does
  // not have. The shared bus itself is not reused: its origin is the browser's
  // UI thread, and taking it over from here would move the thread every other
  // caller's signals are delivered on.
  options.dbus_task_runner = base::ThreadPool::CreateSingleThreadTaskRunner(
      {base::MayBlock(), base::TaskPriority::USER_BLOCKING},
      base::SingleThreadTaskRunnerThreadMode::SHARED);
  bus_ = base::MakeRefCounted<dbus::Bus>(std::move(options));

  dbus::ObjectProxy* manager =
      bus_->GetObjectProxy(kLogind, dbus::ObjectPath(kManagerPath));
  dbus::MethodCall find_session(kManagerInterface, kGetSessionByPID);
  dbus::MessageWriter writer(&find_session);
  // Zero is logind's word for "whoever is asking", answered from the D-Bus
  // sender's credentials -- so this needs neither `XDG_SESSION_ID` nor a pid
  // that means the same thing on both sides of a namespace.
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

  // SUBSCRIBED BEFORE CONTROL IS TAKEN. logind starts sending this session's
  // device signals the moment it has control, and a `PauseDevice` that arrives
  // before the subscription is one nothing answers -- which holds the console
  // switch open until logind's own timeout.
  if (!ConnectAndBlock(kSignalPauseDevice,
                       base::BindRepeating(&DrmLogindInput::OnPauseDevice,
                                           base::Unretained(this))) ||
      !ConnectAndBlock(kSignalResumeDevice,
                       base::BindRepeating(&DrmLogindInput::OnResumeDevice,
                                           base::Unretained(this)))) {
    LOG(FATAL) << "cannot follow logind's device signals on "
               << session_path.value()
               << ", so a console switch would leave this session holding "
               << "every keyboard it was given";
  }

  dbus::MethodCall take_control(kSessionInterface, kTakeControl);
  dbus::MessageWriter control_writer(&take_control);
  // Not forced. Taking control away from whatever holds it would leave two
  // processes believing they own the session's devices, and the other one is
  // as likely to be the desktop the user is actually looking at.
  control_writer.AppendBool(false);
  if (!CallAndBlock(session_, &take_control)) {
    LOG(FATAL) << "logind refused control of session " << session_path.value()
               << ". " << kNoSession;
  }
}

DrmLogindInput::~DrmLogindInput() {
  // Explicitly, and before the bus: `devices_`' own destructor would release
  // too, but it runs after this body, and by then `ReleaseDevice` would be
  // asked to talk over a bus this has already shut down.
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
  // A REOPEN ASKED FOR BY A RESUME, AND IT MUST NOT ASK logind AGAIN.
  // `TakeDevice` for a device this session already holds is refused, so the
  // descriptor the `ResumeDevice` signal carried is the only one there will
  // be. Every ordinary open -- the first scan, a real hotplug -- finds nothing
  // waiting here and falls through.
  base::ScopedFD resumed = devices_.Resumed(params.path);
  if (resumed.is_valid()) {
    return resumed;
  }

  const std::optional<DeviceNumber> number = NumberOfDevice(params.path);
  if (!number.has_value()) {
    return base::ScopedFD();
  }

  dbus::MethodCall take_device(kSessionInterface, kTakeDevice);
  WriteDeviceNumber(&take_device, *number);
  std::unique_ptr<dbus::Response> taken = CallAndBlock(session_, &take_device);
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

  // THE DESCRIPTOR IS ANOTHER PROCESS'S OPEN, so the flags the evdev
  // converters need are asserted here rather than assumed: a blocking read on
  // this thread is every input device in the desktop stopping together.
  if (HANDLE_EINTR(fcntl(fd.get(), F_SETFL, O_NONBLOCK)) < 0) {
    PLOG(ERROR) << "cannot make " << params.path.value() << " non-blocking";
    return base::ScopedFD();
  }

  devices_.Take(*number, params.id, params.path);
  return fd;
}

void DrmLogindInput::ReopenDevice(int id, const base::FilePath& path) {
  // THE FACTORY OWNS THIS OBJECT, so it is there whenever a signal can be
  // delivered -- but it hands the callback over after construction, because
  // an opener is built to be given to the factory and cannot be given the
  // factory first.
  reopen_device().Run(id, path);
}

std::unique_ptr<dbus::Response> DrmLogindInput::CallAndBlock(
    dbus::ObjectProxy* proxy,
    dbus::MethodCall* call) {
  std::unique_ptr<dbus::Response> response;
  base::WaitableEvent answered;

  // Unretained on stack storage is what the wait makes safe: nothing here
  // returns until the task has signalled, so the pointers outlive it.
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
    const std::string& signal,
    dbus::ObjectProxy::SignalCallback callback) {
  bool connected = false;
  base::WaitableEvent done;

  bus_->GetDBusTaskRunner()->PostTask(
      FROM_HERE,
      base::BindOnce(
          [](dbus::ObjectProxy* session, const std::string& signal,
             dbus::ObjectProxy::SignalCallback callback, bool* connected,
             base::WaitableEvent* done) {
            *connected = session->ConnectToSignalAndBlock(
                kSessionInterface, signal, std::move(callback));
            done->Signal();
          },
          base::Unretained(session_.get()), signal, std::move(callback),
          base::Unretained(&connected), base::Unretained(&done)));

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

  if (devices_.Pause(number, type) == PauseAnswer::kNothingToSay) {
    return;
  }

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

bool DrmLogindInput::ReleaseDevice(DeviceNumber number) {
  dbus::MethodCall release(kSessionInterface, kReleaseDevice);
  WriteDeviceNumber(&release, number);
  return CallAndBlock(session_, &release) != nullptr;
}

}  // namespace ui
