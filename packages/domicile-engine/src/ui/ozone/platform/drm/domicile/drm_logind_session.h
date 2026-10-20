// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_LOGIND_SESSION_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_LOGIND_SESSION_H_

#include <memory>
#include <map>
#include <optional>
#include <string>

#include "base/files/file_path.h"
#include "base/files/scoped_file.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/synchronization/lock.h"
#include "base/task/sequenced_task_runner.h"
#include "base/thread_annotations.h"
#include "base/threading/thread.h"
#include "dbus/bus.h"
#include "dbus/message.h"
#include "dbus/object_proxy.h"
#include "ui/ozone/platform/drm/domicile/drm_input_devices.h"

namespace ui {

// A device descriptor from `Session.TakeDevice`.
struct TakenDevice {
  TakenDevice(base::ScopedFD descriptor, bool inactive);
  TakenDevice(TakenDevice&&);
  TakenDevice& operator=(TakenDevice&&);
  ~TakenDevice();

  base::ScopedFD descriptor;
  // True when the session is not in front of the user. logind then returns
  // an input device already revoked, and a card without DRM master.
  bool inactive = false;
};

// Answers `TakeDevice`: the device, or nothing when logind refused it.
using TakeAnswer = base::OnceCallback<void(std::optional<TakenDevice>)>;

// Receives the session's signals about input devices, on its own sequence.
class DrmLogindInputListener {
 public:
  virtual ~DrmLogindInputListener() = default;

  // `type` is "pause", "force" or "gone".
  virtual void OnPauseDevice(DeviceNumber number, const std::string& type) = 0;
  virtual void OnResumeDevice(DeviceNumber number,
                              base::ScopedFD descriptor) = 0;
  // A session property changed. `Active` may be one of them.
  virtual void OnSessionChanged() = 0;
};

// Holds control of this process's logind session, and the D-Bus connection
// that took it.
//
// logind accepts `TakeDevice` only from the connection that called
// `TakeControl`, so the cards and the input devices share this one.
// Design: docs/TTY-SESSION.md.
//
// Built on the UI thread before anything opens a card, which is before the
// evdev thread starts. Calls block on the bus's own `DEDICATED` thread and
// answer on the caller's sequence; signals arrive on the UI thread and the
// input ones go to the listener's sequence.
class DrmLogindSession {
 public:
  // Takes control of the session, and subscribes to its device signals first
  // so no pause is missed. Blocks. Fatal when logind refuses.
  DrmLogindSession();

  DrmLogindSession(const DrmLogindSession&) = delete;
  DrmLogindSession& operator=(const DrmLogindSession&) = delete;

  // Gives control back, which releases every device. Blocks.
  ~DrmLogindSession();

  // Takes the card at `node`, `/dev/dri/cardN`, from logind, releasing it
  // first when this session holds it. Invalid when logind refuses. Blocks;
  // callable from any thread.
  //
  // logind sets DRM master on the card while the session is active, drops it
  // when the console switches away and sets it again on the way back.
  base::ScopedFD TakeCard(const base::FilePath& node);

  // Gives the card at `node` back. Does not wait. Callable from any thread.
  void ReleaseCard(const base::FilePath& node);

  // Input-device calls on the session. Each answers on the caller's sequence
  // and does not block it.
  void TakeDevice(DeviceNumber number, TakeAnswer answered);
  void ReleaseDevice(DeviceNumber number, ReleaseAnswer answered);
  void CompletePause(DeviceNumber number);

  // Answers whether the session is active. A refusal is logged and answered
  // as inactive; the next `OnSessionChanged` asks again.
  void ReadActive(base::OnceCallback<void(bool)> answered);

  // Sends input-device signals to `listener` on the caller's sequence. They
  // are dropped until then, when no input device is held.
  void Listen(base::WeakPtr<DrmLogindInputListener> listener);

 private:
  // Calls `call` on the session object without blocking the caller.
  // `answered` runs on the caller's sequence with the response, or null after
  // the error is logged.
  void Call(std::unique_ptr<dbus::MethodCall> call,
            base::OnceCallback<void(std::unique_ptr<dbus::Response>)>
                answered);

  // Runs `call` on the bus's thread and blocks this one until it answers.
  // Null after the error is logged.
  std::unique_ptr<dbus::Response> CallAndBlock(dbus::ObjectProxy* proxy,
                                               dbus::MethodCall* call);

  // Subscribes on the bus's thread and blocks until done.
  bool ConnectAndBlock(const std::string& interface,
                       const std::string& signal,
                       dbus::ObjectProxy::SignalCallback callback);

  void OnPauseDevice(dbus::Signal* signal);
  void OnResumeDevice(dbus::Signal* signal);
  void OnPropertiesChanged(dbus::Signal* signal);

  // Runs `signal` with the listener on its sequence, or drops it when nothing
  // listens yet.
  using ListenerSignal =
      base::OnceCallback<void(base::WeakPtr<DrmLogindInputListener>)>;
  void ToListener(ListenerSignal signal);

  // The bus's thread, stopped once the bus has shut down on it.
  base::Thread bus_thread_{"DrmLogind"};
  scoped_refptr<dbus::Bus> bus_;
  raw_ptr<dbus::ObjectProxy> session_ = nullptr;

  base::Lock lock_;
  // Cards this session holds, which `TakeDevice` would refuse, by node. Keyed
  // by node because an unplugged node cannot be statted for its number.
  std::map<base::FilePath, DeviceNumber> cards_ GUARDED_BY(lock_);
  scoped_refptr<base::SequencedTaskRunner> listener_runner_
      GUARDED_BY(lock_);
  base::WeakPtr<DrmLogindInputListener> listener_ GUARDED_BY(lock_);

  base::WeakPtrFactory<DrmLogindSession> weak_factory_{this};
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_LOGIND_SESSION_H_
