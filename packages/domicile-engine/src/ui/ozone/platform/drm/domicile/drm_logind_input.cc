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

// The session's own properties, which is where the answer to "is this console
// in front of the user" lives. `DrmVtSwitcher` reads the same one for the
// display; see the header for why the subscription is not shared.
constexpr char kPropertiesInterface[] = "org.freedesktop.DBus.Properties";
constexpr char kPropertiesGet[] = "Get";
constexpr char kPropertiesChanged[] = "PropertiesChanged";
constexpr char kActive[] = "Active";

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
  // A thread-pool worker installs a `FileDescriptorWatcher` for the scope
  // tasks run in (`base/task/thread_pool/worker_thread.cc`), which is what the
  // bus needs to watch its socket and what the evdev thread does not have. The
  // browser's shared bus is not reused either: its origin is the UI thread,
  // and taking it over from here would move the thread every other caller's
  // signals are delivered on.
  //
  // DEDICATED, AND THIS IS THE ONE BUS THAT MAKES IT NON-NEGOTIABLE. The calls
  // below are synchronous because `OpenInputDevice` has to answer with a
  // descriptor, so `CallAndBlock` posts `CallMethodAndBlock` to this thread
  // and waits -- and libdbus does not return to the message loop until logind
  // answers. A `SHARED` runner puts every bus with these traits on that one
  // thread, so for the length of every round trip made here NO OTHER BUS CAN
  // READ ITS SOCKET.
  //
  // What that starves is a console switch. logind force-pauses every device at
  // once, and each one costs three blocking round trips from the evdev thread
  // -- `ReleaseDevice`, `TakeDevice`, `Active` -- which on a laptop with
  // fifteen input devices is some forty-five, back to back. `DrmVtSwitcher`
  // hears that the session went inactive only through `PropertiesChanged` on
  // ITS bus, and shared, that signal queues behind the whole storm. A
  // relinquish that lands late is a GPU process still committing flips into a
  // card whose console is somebody else's: the commit fails, `PageFlipWatchdog`
  // arms, and fifteen seconds later it is `LOG(FATAL) ... Crashing GPU
  // process.` Losing that race depends on how fast logind services forty-five
  // calls, which is why a desktop wedged sometimes on the way out and
  // sometimes on the way back rather than every time.
  //
  // A thread is the cheap half of the answer and not the whole of it: the
  // evdev thread still stops for the length of the storm, so input is frozen
  // across a switch either way. Unblocking THAT means making
  // `InputDeviceOpener::OpenInputDevice` asynchronous, which is a change to a
  // contract Chromium owns -- see the header.
  options.dbus_task_runner = base::ThreadPool::CreateSingleThreadTaskRunner(
      {base::MayBlock(), base::TaskPriority::USER_BLOCKING},
      base::SingleThreadTaskRunnerThreadMode::DEDICATED);
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
  //
  // AND THE ACTIVATION IS ONE OF THEM. A "force" pause revokes every
  // descriptor this session has and no `ResumeDevice` is promised afterwards,
  // so the session's own `Active` property is what says the devices can be
  // taken again. Subscribed here for the same reason as the other two: an
  // activation that arrives before the subscription is one nothing answers,
  // and nothing else will ask.
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
    VLOG(1) << "domicile: " << params.path.value()
            << " is opening on the descriptor a resume left for it";
    return resumed;
  }

  VLOG(1) << "domicile: asking logind for " << params.path.value();

  const std::optional<DeviceNumber> number = NumberOfDevice(params.path);
  if (!number.has_value()) {
    return base::ScopedFD();
  }

  // TWICE AT MOST, AND THE SECOND TIME ONLY FOR A RACE. logind can answer
  // `TakeDevice` with a descriptor it has already revoked -- the `inactive`
  // half of the reply below -- and the fix for that is an `Active` edge, which
  // `OnPropertiesChanged` follows. But logind emits `PropertiesChanged` on a
  // CHANGE, and a session that was already in front of the user when this scan
  // ran never changes: there is no edge, `Reclaim` is never called, and every
  // device stays revoked for the life of the process. That is a desktop that
  // draws and is deaf from its first frame, with no keyboard to leave the
  // console with either. So an inactive answer is checked against the session
  // instead of believed, and a stale one is simply asked again.
  for (int attempt = 0; attempt < 2; ++attempt) {
    // GIVEN BACK BEFORE IT IS ASKED FOR AGAIN. `TakeDevice` for a device this
    // session still holds is refused with `Device is taken`, and a descriptor
    // logind has revoked is replaced by nothing else -- so a device that is
    // here for a second time (a "force" pause, an activation after one, or
    // the retry below) has to go back to logind first. An ordinary open holds
    // nothing and this is a no-op for it.
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

    // THE REPLY IS `hb` AND THE `b` IS `inactive`, NOT `active`. logind writes
    // `!sd->active` there, and it is not decoration: for a session that is not
    // the one in front of the user, `session_device_new` opens the node with
    // `session_device_open`'s `active` argument false, which `EVIOCREVOKE`s
    // the descriptor before handing it over. logind's own comment there says
    // the caller must not trust the descriptor and must read this boolean
    // instead. Popping only the descriptor is how a startup scan that lands
    // during an inactive moment ends up with a desktop full of dead devices
    // and no complaint anywhere.
    bool inactive = false;
    if (!reader.PopBool(&inactive)) {
      LOG(FATAL) << "logind answered " << kTakeDevice << " for "
                 << params.path.value()
                 << " without saying whether the device is live";
    }

    if (!inactive) {
      // THE DESCRIPTOR IS ANOTHER PROCESS'S OPEN, so the flags the evdev
      // converters need are asserted here rather than assumed: a blocking
      // read on this thread is every input device in the desktop stopping
      // together.
      if (HANDLE_EINTR(fcntl(fd.get(), F_SETFL, O_NONBLOCK)) < 0) {
        PLOG(ERROR) << "cannot make " << params.path.value()
                    << " non-blocking";
        return base::ScopedFD();
      }

      devices_.Take(*number, params.id, params.path, DeviceLiveness::kLive);
      return fd;
    }

    // RECORDED, NOT TRUSTED, AND RECORDED BEFORE THE RETRY. logind holds the
    // device for this session either way, so it is still owed back; what it
    // is not is something to build a converter on. Recording it is also what
    // makes the `GiveBack` at the top of the next turn release it rather than
    // find nothing. The descriptor goes out of scope here, unread by anyone.
    devices_.Take(*number, params.id, params.path, DeviceLiveness::kRevoked);

    // ASKED, NOT ASSUMED. If logind says this session is in front of the user
    // right now, the answer above was stale and there is no edge coming to
    // correct it -- so the one retry is spent here. If the session really is
    // in the background, the device is correctly parked and the activation
    // will reclaim it.
    if (attempt == 0 && SessionIsActive()) {
      LOG(WARNING) << "logind handed over " << params.path.value() << " ("
                   << number->major << ":" << number->minor
                   << ") revoked while also saying this session is active; "
                      "taking it again, because no Active edge will arrive to "
                      "do it later";
      continue;
    }

    LOG(WARNING) << "logind handed over " << params.path.value() << " ("
                 << number->major << ":" << number->minor
                 << ") already revoked, because this session is not the one "
                    "in front of the user. Nothing from this device reaches "
                    "the desktop until the session goes Active, which is "
                    "answered by taking it again -- switch back to this "
                    "console (Ctrl+Alt+F<n>) if it does not.";
    return base::ScopedFD();
  }

  // Both turns answered inactive with the session active: logind is saying two
  // things that cannot both be true, and a third ask would not settle it.
  LOG(ERROR) << "logind kept handing over " << params.path.value()
             << " revoked while saying this session is active, so this device "
                "stays dead. `loginctl session-status` names what else holds "
                "the session.";
  return base::ScopedFD();
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
  // returns until the task has signaled, so the pointers outlive it.
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
      // THE LINE THAT WAS MISSING, AND THE REASON THIS COST A REBOOT. A
      // desktop whose every keyboard and every trackpad stopped in the same
      // instant said nothing at all in its own log. It says this instead,
      // once per device, naming the way out.
      LOG(WARNING) << "logind force-paused input device " << number.major << ":"
                   << number.minor
                   << ": it has ALREADY revoked that descriptor, and a force "
                      "pause comes for every input device this session holds "
                      "at once -- so the desktop is deaf from here. Taking "
                      "them back when the session goes Active; if input does "
                      "not return, switch to this console with "
                      "Ctrl+Alt+F<n>.";
      return;

    case PauseAnswer::kCompleteIt:
      break;
  }

  // ONLY A SEAT WITHOUT VTs EVER GETS HERE, and every laptop has VTs -- see
  // `PauseAnswer::kCompleteIt`. It is a blocking call made from a signal
  // callback, which is safe and not by luck: `ObjectProxy::HandleMessage`
  // posts a signal to the bus's ORIGIN thread (this one, the evdev thread)
  // while `CallMethodAndBlock` asserts it is on the bus's D-BUS thread, so
  // `CallAndBlock` posts it there and waits. The thread that has to read the
  // reply is never the thread that is waiting for it.
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
  // The message is not read, for the reason `DrmVtSwitcher` does not read it:
  // logind names a changed property in the dictionary or in the invalidated
  // list depending on which property it is, and asking for the one value that
  // matters is cheaper than being right about that. A property this does not
  // care about costs one round trip and no decision.
  const bool active = SessionIsActive();

  // TRACED ON BOTH ARMS. This is the only edge that brings a revoked device
  // back when no resume is coming, so "did it fire, and what did logind say"
  // is the first question of any run that came up deaf -- and a handler that
  // spoke only when it had something to reclaim could not be told apart from
  // one that was never called.
  VLOG(1) << "domicile: logind changed a session property; this session is "
          << (active ? "in front of the user" : "not in front of the user");

  if (!active) {
    return;
  }

  const size_t reclaimed = devices_.Reclaim();
  if (reclaimed > 0) {
    LOG(WARNING) << "this console is in front of the user again; giving "
                 << reclaimed
                 << " revoked input device(s) back to logind and taking them "
                    "again, because a revoked descriptor cannot be repaired "
                    "in place";
  }
}

bool DrmLogindInput::SessionIsActive() {
  dbus::MethodCall get(kPropertiesInterface, kPropertiesGet);
  dbus::MessageWriter writer(&get);
  writer.AppendString(kSessionInterface);
  writer.AppendString(kActive);

  std::unique_ptr<dbus::Response> answered = CallAndBlock(session_, &get);
  if (!answered) {
    // NOT A FALLBACK, A RETRY. logind emits `PropertiesChanged` on every
    // property this session has, so the next one asks again; what must not
    // happen is a revoked device being treated as live on the strength of an
    // answer nobody got.
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
