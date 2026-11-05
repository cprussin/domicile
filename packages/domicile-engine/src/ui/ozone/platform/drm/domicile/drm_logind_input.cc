// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_logind_input.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/logging.h"

namespace ui {

DrmLogindInput::DrmLogindInput(DrmLogindSession* session)
    : session_(session),
      devices_(base::BindRepeating(&DrmLogindInput::ReleaseDevice,
                                   base::Unretained(this)),
               base::BindRepeating(&DrmLogindInput::ReopenDevice,
                                   base::Unretained(this))),
      opens_(devices_,
             base::BindRepeating(&DrmLogindSession::TakeDevice,
                                 base::Unretained(session)),
             base::BindRepeating(&DrmLogindSession::ReadActive,
                                 base::Unretained(session))) {
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
  if (!opens_.CanResume(number)) {
    VLOG(1) << "domicile: dropping obsolete input resume " << number.major
            << ":" << number.minor;
    return;
  }
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
  VLOG(2) << "domicile: asking logind for " << params.path.value();

  const std::optional<DeviceNumber> number = NumberOfDevice(params.path);
  if (!number.has_value()) {
    std::move(opened).Run(base::ScopedFD());
    return;
  }

  opens_.Open(*number, params.id, params.path, params.is_current,
              std::move(opened));
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
