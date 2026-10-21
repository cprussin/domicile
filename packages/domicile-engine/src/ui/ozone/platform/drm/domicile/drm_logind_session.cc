// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_logind_session.h"

#include <fcntl.h>

#include <utility>

#include "base/functional/bind.h"
#include "base/location.h"
#include "base/logging.h"
#include "base/posix/eintr_wrapper.h"
#include "base/synchronization/waitable_event.h"
#include "base/task/bind_post_task.h"
// Needed for the upcast to `scoped_refptr<base::SequencedTaskRunner>` in
// `Bus::Options`; other headers only forward-declare it.
#include "base/task/single_thread_task_runner.h"
#include "base/message_loop/message_pump_type.h"
#include "base/threading/thread_restrictions.h"
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

// The session's `Active` property. `DrmVtSwitcher` follows it on its own bus,
// on the UI thread; the input devices follow it here.
constexpr char kPropertiesInterface[] = "org.freedesktop.DBus.Properties";
constexpr char kPropertiesGet[] = "Get";
constexpr char kPropertiesChanged[] = "PropertiesChanged";
constexpr char kActive[] = "Active";

// logind's `PauseDevice` type that waits for `PauseDeviceComplete`.
constexpr char kPauseTypePause[] = "pause";

// The kernel's major number for DRM cards (`DRM_MAJOR`). The session's
// signals carry only numbers, and the cards are handled here rather than by
// the input listener.
constexpr uint32_t kDrmMajor = 226;

// Explains a failure to take the session and how to fix it, for the fatal
// log.
constexpr char kNoSession[] =
    "Domicile takes every card, keyboard and mouse from logind's "
    "org.freedesktop.login1.Session, because no ACL covers an input device "
    "and the alternative -- the `input` group -- is a standing keyboard grant "
    "to every process this user runs. Start Domicile from a logind session on "
    "a tty of its own (a plain `login` on a free VT is one), and stop whatever "
    "else holds control of that session: logind gives TakeControl to one "
    "process at a time, so a display manager or another compositor still "
    "running on this VT is enough to refuse it.";

// Reads the major and minor that start every logind device signal.
DeviceNumber ReadDeviceNumber(dbus::MessageReader* reader) {
  DeviceNumber number;
  if (!reader->PopUint32(&number.major) || !reader->PopUint32(&number.minor)) {
    LOG(FATAL) << "logind sent a device message with no device in it";
  }
  return number;
}

std::unique_ptr<dbus::MethodCall> DeviceCall(const char* member,
                                             DeviceNumber number) {
  auto call = std::make_unique<dbus::MethodCall>(kSessionInterface, member);
  dbus::MessageWriter writer(call.get());
  writer.AppendUint32(number.major);
  writer.AppendUint32(number.minor);
  return call;
}

// Runs on the bus's thread.
std::unique_ptr<dbus::Response> CallOnBusThread(dbus::ObjectProxy* proxy,
                                                dbus::MethodCall* call) {
  auto result =
      proxy->CallMethodAndBlock(call, dbus::ObjectProxy::TIMEOUT_USE_DEFAULT);
  if (!result.has_value()) {
    LOG(ERROR) << "logind refused " << call->GetMember() << ": "
               << result.error().name() << ": " << result.error().message();
    return nullptr;
  }
  return std::move(result.value());
}

// Reads a `TakeDevice` reply, `(h fd, b inactive)`.
std::optional<TakenDevice> ReadTakenDevice(dbus::Response* response) {
  if (!response) {
    return std::nullopt;
  }

  dbus::MessageReader reader(response);
  base::ScopedFD descriptor;
  bool inactive = false;
  if (!reader.PopFileDescriptor(&descriptor) || !reader.PopBool(&inactive)) {
    LOG(FATAL) << "logind answered " << kTakeDevice
               << " with something other than a descriptor and whether the "
                  "session is inactive";
  }
  return TakenDevice(std::move(descriptor), inactive);
}

}  // namespace

TakenDevice::TakenDevice(base::ScopedFD descriptor, bool inactive)
    : descriptor(std::move(descriptor)), inactive(inactive) {}

TakenDevice::TakenDevice(TakenDevice&&) = default;

TakenDevice& TakenDevice::operator=(TakenDevice&&) = default;

TakenDevice::~TakenDevice() = default;

DrmLogindSession::DrmLogindSession() {
  dbus::Bus::Options options;
  options.bus_type = dbus::Bus::SYSTEM;
  options.connection_type = dbus::Bus::PRIVATE;
  // A thread of its own, not a thread-pool worker. The constructor runs in
  // `InitializeUI` and blocks the UI thread on this thread's answers. A pool
  // task posted here never ran, and the browser hung before its first log
  // line (`tty-on-a-card-with-no-3d`). An IO thread has the
  // `FileDescriptorWatcher` the bus needs.
  //
  // Not shared: calls here block this thread until logind answers, and a
  // console switch's input calls would delay `DrmVtSwitcher`'s
  // `PropertiesChanged`. See docs/TTY-SESSION.md#the-d-bus-thread.
  CHECK(bus_thread_.StartWithOptions(
      base::Thread::Options(base::MessagePumpType::IO, 0)))
      << "cannot start the thread that talks to logind";
  options.dbus_task_runner = bus_thread_.task_runner();
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
                       base::BindRepeating(&DrmLogindSession::OnPauseDevice,
                                           weak_factory_.GetWeakPtr())) ||
      !ConnectAndBlock(kSessionInterface, kSignalResumeDevice,
                       base::BindRepeating(&DrmLogindSession::OnResumeDevice,
                                           weak_factory_.GetWeakPtr())) ||
      !ConnectAndBlock(
          kPropertiesInterface, kPropertiesChanged,
          base::BindRepeating(&DrmLogindSession::OnPropertiesChanged,
                              weak_factory_.GetWeakPtr()))) {
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

DrmLogindSession::~DrmLogindSession() {
  // logind releases every device this session holds along with control.
  dbus::MethodCall release_control(kSessionInterface, kReleaseControl);
  if (!CallAndBlock(session_, &release_control)) {
    LOG(ERROR) << "logind refused to take back control of this session";
  }

  weak_factory_.InvalidateWeakPtrs();
  session_ = nullptr;
  bus_->ShutdownOnDBusThreadAndBlock();
  base::ScopedAllowBaseSyncPrimitivesOutsideBlockingScope allow_join;
  bus_thread_.Stop();
}

base::ScopedFD DrmLogindSession::TakeCard(const base::FilePath& node) {
  const std::optional<DeviceNumber> number = NumberOfDevice(node);
  if (!number.has_value()) {
    return base::ScopedFD();
  }

  base::AutoLock hold(lock_);

  // `TakeDevice` refuses a device this session holds. A relaunched GPU
  // process takes its card again.
  const auto held = cards_.find(node);
  if (held != cards_.end()) {
    std::unique_ptr<dbus::MethodCall> release =
        DeviceCall(kReleaseDevice, held->second);
    cards_.erase(held);
    if (!CallAndBlock(session_, release.get())) {
      LOG(ERROR) << "logind would not take back " << node.value()
                 << ", so it cannot hand it over again";
      return base::ScopedFD();
    }
  }

  std::unique_ptr<dbus::MethodCall> take = DeviceCall(kTakeDevice, *number);
  std::unique_ptr<dbus::Response> response =
      CallAndBlock(session_, take.get());
  std::optional<TakenDevice> taken = ReadTakenDevice(response.get());
  if (!taken.has_value()) {
    LOG(ERROR) << "logind refused " << node.value();
    return base::ScopedFD();
  }
  cards_[node] = *number;

  // logind opens the card non-blocking. Chromium's DRM code expects the
  // blocking descriptor its own open gives.
  const int flags = HANDLE_EINTR(fcntl(taken->descriptor.get(), F_GETFL));
  if (flags < 0 || HANDLE_EINTR(fcntl(taken->descriptor.get(), F_SETFL,
                                      flags & ~O_NONBLOCK)) < 0) {
    PLOG(ERROR) << "cannot make " << node.value() << " blocking";
    return base::ScopedFD();
  }

  // Not an error: logind sets master on the card when the session comes to
  // the front, and `DrmVtSwitcher` follows that.
  VLOG(1) << "domicile: took " << node.value() << " (" << number->major << ":"
          << number->minor << ") from logind"
          << (taken->inactive ? ", without DRM master: the session is not in "
                                "front of the user"
                              : "");
  return std::move(taken->descriptor);
}

void DrmLogindSession::ReleaseCard(const base::FilePath& node) {
  DeviceNumber number;
  {
    base::AutoLock hold(lock_);
    const auto held = cards_.find(node);
    if (held == cards_.end()) {
      LOG(ERROR) << "asked to give back " << node.value()
                 << ", which this session does not hold";
      return;
    }
    number = held->second;
    cards_.erase(held);
  }

  Call(DeviceCall(kReleaseDevice, number),
       base::BindOnce(
           [](const base::FilePath& node,
              std::unique_ptr<dbus::Response> response) {
             if (!response) {
               LOG(ERROR) << "logind would not take back " << node.value();
             }
           },
           node));
}

void DrmLogindSession::TakeDevice(DeviceNumber number, TakeAnswer answered) {
  Call(DeviceCall(kTakeDevice, number),
       base::BindOnce(
           [](TakeAnswer answered, std::unique_ptr<dbus::Response> response) {
             std::move(answered).Run(ReadTakenDevice(response.get()));
           },
           std::move(answered)));
}

void DrmLogindSession::ReleaseDevice(DeviceNumber number,
                                     ReleaseAnswer answered) {
  Call(DeviceCall(kReleaseDevice, number),
       base::BindOnce(
           [](ReleaseAnswer answered,
              std::unique_ptr<dbus::Response> response) {
             std::move(answered).Run(response != nullptr);
           },
           std::move(answered)));
}

void DrmLogindSession::CompletePause(DeviceNumber number) {
  Call(DeviceCall(kPauseDeviceComplete, number),
       base::BindOnce(
           [](DeviceNumber number, std::unique_ptr<dbus::Response> response) {
             if (!response) {
               LOG(ERROR) << "logind would not take " << kPauseDeviceComplete
                          << " for " << number.major << ":" << number.minor
                          << ", so the console switch waits for its own "
                             "timeout";
             }
           },
           number));
}

void DrmLogindSession::ReadActive(base::OnceCallback<void(bool)> answered) {
  auto get = std::make_unique<dbus::MethodCall>(kPropertiesInterface,
                                                kPropertiesGet);
  dbus::MessageWriter writer(get.get());
  writer.AppendString(kSessionInterface);
  writer.AppendString(kActive);

  Call(std::move(get),
       base::BindOnce(
           [](base::OnceCallback<void(bool)> answered,
              std::unique_ptr<dbus::Response> response) {
             if (!response) {
               LOG(ERROR) << "logind would not say whether this session is "
                             "active, so any input device it has revoked "
                             "stays revoked until the next time it says so";
               std::move(answered).Run(false);
               return;
             }

             dbus::MessageReader reader(response.get());
             bool active = false;
             if (!reader.PopVariantOfBool(&active)) {
               LOG(FATAL) << "logind answered " << kActive
                          << " with something that is not a boolean";
             }
             std::move(answered).Run(active);
           },
           std::move(answered)));
}

void DrmLogindSession::Listen(base::WeakPtr<DrmLogindInputListener> listener) {
  base::AutoLock hold(lock_);
  listener_runner_ = base::SequencedTaskRunner::GetCurrentDefault();
  listener_ = std::move(listener);
}

void DrmLogindSession::Call(
    std::unique_ptr<dbus::MethodCall> call,
    base::OnceCallback<void(std::unique_ptr<dbus::Response>)> answered) {
  // Unretained: the bus shuts down on its own thread after every task posted
  // to it, and the proxy lives until then.
  bus_->GetDBusTaskRunner()->PostTask(
      FROM_HERE,
      base::BindOnce(
          [](dbus::ObjectProxy* proxy, std::unique_ptr<dbus::MethodCall> call,
             base::OnceCallback<void(std::unique_ptr<dbus::Response>)>
                 answered) {
            std::move(answered).Run(CallOnBusThread(proxy, call.get()));
          },
          base::Unretained(session_.get()), std::move(call),
          base::BindPostTaskToCurrentDefault(std::move(answered))));
}

std::unique_ptr<dbus::Response> DrmLogindSession::CallAndBlock(
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
            *response = CallOnBusThread(proxy, call);
            answered->Signal();
          },
          base::Unretained(proxy), base::Unretained(call),
          base::Unretained(&response), base::Unretained(&answered)));

  // The UI thread waits here at startup and when the GPU process opens a
  // card. logind answers in one round trip, and nothing can draw before the
  // card is held.
  base::ScopedAllowBaseSyncPrimitivesOutsideBlockingScope allow_wait;
  answered.Wait();
  return response;
}

bool DrmLogindSession::ConnectAndBlock(
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

  base::ScopedAllowBaseSyncPrimitivesOutsideBlockingScope allow_wait;
  done.Wait();
  return connected;
}

void DrmLogindSession::OnPauseDevice(dbus::Signal* signal) {
  dbus::MessageReader reader(signal);
  const DeviceNumber number = ReadDeviceNumber(&reader);
  std::string type;
  if (!reader.PopString(&type)) {
    LOG(FATAL) << "logind sent a " << kSignalPauseDevice << " with no type";
  }

  if (number.major != kDrmMajor) {
    ToListener(base::BindOnce(
        [](DeviceNumber number, const std::string& type,
           base::WeakPtr<DrmLogindInputListener> listener) {
          if (listener) {
            listener->OnPauseDevice(number, type);
          }
        },
        number, type));
    return;
  }

  // logind has dropped DRM master already ("force"), or drops it once
  // answered ("pause"). The GPU process skips the frames that fail meanwhile,
  // and `DrmVtSwitcher` stops drawing when `Active` goes false.
  VLOG(1) << "domicile: logind paused card " << number.major << ":"
          << number.minor << " (" << type << ")";
  if (type == kPauseTypePause) {
    CompletePause(number);
  }
}

void DrmLogindSession::OnResumeDevice(dbus::Signal* signal) {
  dbus::MessageReader reader(signal);
  const DeviceNumber number = ReadDeviceNumber(&reader);
  base::ScopedFD descriptor;
  if (!reader.PopFileDescriptor(&descriptor)) {
    LOG(FATAL) << "logind sent a " << kSignalResumeDevice
               << " with no descriptor";
  }

  if (number.major != kDrmMajor) {
    ToListener(base::BindOnce(
        [](DeviceNumber number, base::ScopedFD descriptor,
           base::WeakPtr<DrmLogindInputListener> listener) {
          if (listener) {
            listener->OnResumeDevice(number, std::move(descriptor));
          }
        },
        number, std::move(descriptor)));
    return;
  }

  // logind set master again on the descriptor this session already holds; the
  // one in the signal shares it and closes here. `DrmVtSwitcher` takes the
  // display back when `Active` goes true.
  VLOG(1) << "domicile: logind resumed card " << number.major << ":"
          << number.minor;
}

void DrmLogindSession::OnPropertiesChanged(dbus::Signal*) {
  ToListener(
      base::BindOnce([](base::WeakPtr<DrmLogindInputListener> listener) {
        if (listener) {
          listener->OnSessionChanged();
        }
      }));
}

void DrmLogindSession::ToListener(ListenerSignal signal) {
  base::AutoLock hold(lock_);
  if (!listener_runner_) {
    VLOG(1) << "domicile: no input listener yet, so a logind signal is "
               "dropped; no input device is held";
    return;
  }
  // The weak pointer is checked on the listener's sequence, where it lives.
  listener_runner_->PostTask(FROM_HERE,
                             base::BindOnce(std::move(signal), listener_));
}

}  // namespace ui
