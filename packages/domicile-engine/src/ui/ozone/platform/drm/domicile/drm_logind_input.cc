// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_logind_input.h"

#include <fcntl.h>

#include <utility>

#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/posix/eintr_wrapper.h"

namespace ui {

DrmLogindInput::DrmLogindInput(DrmLogindSession* session)
    : session_(session),
      devices_(base::BindRepeating(&DrmLogindInput::ReleaseDevice,
                                   base::Unretained(this)),
               base::BindRepeating(&DrmLogindInput::ReopenDevice,
                                   base::Unretained(this))) {
  // Before any device is taken, so no pause for one is missed.
  session_->Listen(weak_factory_.GetWeakPtr());
}

DrmLogindInput::~DrmLogindInput() {
  // Release now, while `this` can still reach the session. The answers come
  // after this is gone and are dropped; a refusal is logged.
  devices_.Release();
}

void DrmLogindInput::OnPauseDevice(DeviceNumber number,
                                   const std::string& type) {
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
      // Only seats without VTs reach this.
      session_->CompletePause(number);
      return;
  }
}

void DrmLogindInput::OnResumeDevice(DeviceNumber number,
                                    base::ScopedFD descriptor) {
  devices_.Resume(number, std::move(descriptor));
}

void DrmLogindInput::OnSessionChanged() {
  // Ask for `Active` instead of parsing the signal, which may report it only
  // as invalidated.
  session_->ReadActive(base::BindOnce(&DrmLogindInput::OnSessionActive,
                                      weak_factory_.GetWeakPtr()));
}

void DrmLogindInput::OpenDeviceFd(const OpenInputDeviceParams& params,
                                  OpenedDeviceFd opened) {
  // A reopen after `ResumeDevice` uses the parked descriptor, since
  // `TakeDevice` refuses a held device. Ordinary opens find nothing parked.
  base::ScopedFD resumed = devices_.Resumed(params.path);
  if (resumed.is_valid()) {
    VLOG(1) << "domicile: " << params.path.value()
            << " is opening on the descriptor a resume left for it";
    std::move(opened).Run(std::move(resumed));
    return;
  }

  VLOG(2) << "domicile: asking logind for " << params.path.value();

  const std::optional<DeviceNumber> number = NumberOfDevice(params.path);
  if (!number.has_value()) {
    std::move(opened).Run(base::ScopedFD());
    return;
  }

  Take(*number, params.id, params.path, 0, std::move(opened));
}

void DrmLogindInput::Take(DeviceNumber number,
                          int id,
                          const base::FilePath& path,
                          int attempt,
                          OpenedDeviceFd opened) {
  // Release first: `TakeDevice` refuses a held device ("Device is taken"). A
  // no-op on a first open. logind answers calls in order, so the take need
  // not wait for the release.
  devices_.GiveBack(number);

  session_->TakeDevice(
      number, base::BindOnce(&DrmLogindInput::OnTaken,
                             weak_factory_.GetWeakPtr(), number, id, path,
                             attempt, std::move(opened)));
}

void DrmLogindInput::OnTaken(DeviceNumber number,
                             int id,
                             const base::FilePath& path,
                             int attempt,
                             OpenedDeviceFd opened,
                             std::optional<TakenDevice> taken) {
  if (!taken.has_value()) {
    LOG(ERROR) << "logind refused device " << number.major << ":"
               << number.minor << " for " << path.value();
    std::move(opened).Run(base::ScopedFD());
    return;
  }

  if (!taken->inactive) {
    // logind opened this descriptor, so set non-blocking here. A blocking
    // read would stall every input device.
    if (HANDLE_EINTR(fcntl(taken->descriptor.get(), F_SETFL, O_NONBLOCK)) <
        0) {
      PLOG(ERROR) << "cannot make " << path.value() << " non-blocking";
      std::move(opened).Run(base::ScopedFD());
      return;
    }

    devices_.Take(number, id, path, DeviceLiveness::kLive);
    std::move(opened).Run(std::move(taken->descriptor));
    return;
  }

  // For an inactive session logind returns an already-revoked descriptor.
  // Record it as revoked: logind still holds it for us, and the next take's
  // `GiveBack` must find it. The descriptor is dropped.
  devices_.Take(number, id, path, DeviceLiveness::kRevoked);

  if (attempt > 0) {
    LOG(ERROR) << "logind kept handing over " << path.value()
               << " revoked while saying this session is active, so this "
                  "device stays dead. `loginctl session-status` names what "
                  "else holds the session.";
    std::move(opened).Run(base::ScopedFD());
    return;
  }

  // An inactive reply is normally fixed by the next `Active` change. If the
  // session is already active, no change will come, so ask.
  session_->ReadActive(base::BindOnce(&DrmLogindInput::OnTakenRevoked,
                                      weak_factory_.GetWeakPtr(), number, id,
                                      path, attempt, std::move(opened)));
}

void DrmLogindInput::OnTakenRevoked(DeviceNumber number,
                                    int id,
                                    const base::FilePath& path,
                                    int attempt,
                                    OpenedDeviceFd opened,
                                    bool active) {
  if (active) {
    LOG(ERROR) << "logind handed over " << path.value() << " ("
               << number.major << ":" << number.minor
               << ") revoked while also saying this session is active; "
                  "taking it again, because no Active edge will arrive to "
                  "do it later";
    Take(number, id, path, attempt + 1, std::move(opened));
    return;
  }

  // Not an error: every switch away lands here once per device.
  VLOG(1) << "domicile: logind handed over " << path.value() << " ("
          << number.major << ":" << number.minor
          << ") revoked, because this session is not the one in front of "
             "the user; taking it again when the session goes Active";
  std::move(opened).Run(base::ScopedFD());
}

void DrmLogindInput::OnSessionActive(bool active) {
  // Log both outcomes, so a run with no input shows whether this fired.
  VLOG(1) << "domicile: logind changed a session property; this session is "
          << (active ? "in front of the user" : "not in front of the user");

  if (!active) {
    return;
  }

  // `Reclaim` logs its own count.
  devices_.Reclaim();
}

void DrmLogindInput::ReopenDevice(int id, const base::FilePath& path) {
  // The factory owns this opener and sets the callback after construction.
  reopen_device().Run(id, path);
}

void DrmLogindInput::ReleaseDevice(DeviceNumber number,
                                   ReleaseAnswer answered) {
  session_->ReleaseDevice(number, std::move(answered));
}

}  // namespace ui
