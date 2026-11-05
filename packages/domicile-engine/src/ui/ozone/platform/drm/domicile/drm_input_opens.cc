// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_input_opens.h"

#include <fcntl.h>

#include <utility>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/posix/eintr_wrapper.h"

namespace ui {

DrmInputOpens::DrmInputOpens(DrmTakenDevices& devices,
                             TakeInputDeviceCall take,
                             ReadSessionActiveCall read_active)
    : devices_(devices),
      take_(std::move(take)),
      read_active_(std::move(read_active)) {}

DrmInputOpens::~DrmInputOpens() = default;

void DrmInputOpens::Open(DeviceNumber number,
                         int id,
                         const base::FilePath& path,
                         base::RepeatingCallback<bool()> is_current,
                         Opened opened) {
  Request request{id, path, std::move(is_current), std::move(opened)};
  auto existing = pending_.find(number);
  if (existing != pending_.end() && existing->second.busy) {
    Opened superseded;
    if (existing->second.queued) {
      superseded = std::move(existing->second.queued->opened);
    }
    existing->second.queued = std::move(request);
    if (superseded) {
      std::move(superseded).Run(base::ScopedFD());
    }
  } else {
    pending_.insert_or_assign(number, Pending{std::move(request)});
    Begin(number);
  }
}

bool DrmInputOpens::CanResume(DeviceNumber number) const {
  auto found = pending_.find(number);
  return found != pending_.end() && !found->second.cleaning &&
         found->second.recorded && IsCurrent(found->second);
}

bool DrmInputOpens::IsCurrent(const Pending& pending) const {
  return !pending.queued &&
         (!pending.current.is_current || pending.current.is_current.Run());
}

void DrmInputOpens::Begin(DeviceNumber number) {
  auto& pending = pending_.at(number);
  if (!IsCurrent(pending)) {
    Finish(number, base::ScopedFD());
    return;
  }
  base::ScopedFD resumed = devices_->Resumed(pending.current.path);
  if (resumed.is_valid()) {
    devices_->Take(number, pending.current.id, pending.current.path,
                   DeviceLiveness::kLive);
    pending.recorded = true;
    Finish(number, std::move(resumed));
    return;
  }
  pending.recorded = false;
  devices_->GiveBack(number);
  take_.Run(number, base::BindOnce(&DrmInputOpens::OnTaken,
                                   weak_factory_.GetWeakPtr(), number));
}

void DrmInputOpens::OnTaken(DeviceNumber number,
                            std::optional<TakenDevice> taken) {
  auto& pending = pending_.at(number);
  if (!IsCurrent(pending)) {
    if (taken) {
      taken->descriptor.reset();
      Cleanup(number);
    } else {
      devices_->Forget(number);
      Finish(number, base::ScopedFD());
    }
  } else if (taken) {
    if (!taken->inactive &&
        HANDLE_EINTR(fcntl(taken->descriptor.get(), F_SETFL, O_NONBLOCK)) < 0) {
      PLOG(ERROR) << "cannot make " << pending.current.path.value()
                  << " non-blocking";
      taken->descriptor.reset();
      Cleanup(number);
      return;
    }
    devices_->Take(
        number, pending.current.id, pending.current.path,
        taken->inactive ? DeviceLiveness::kRevoked : DeviceLiveness::kLive);
    pending.recorded = true;
    if (!taken->inactive) {
      Finish(number, std::move(taken->descriptor));
    } else {
      taken->descriptor.reset();
      if (pending.attempt > 0) {
        LOG(ERROR) << "logind kept handing over "
                   << pending.current.path.value()
                   << " revoked while saying this session is active; "
                      "the device stays disabled until another activation";
        Finish(number, base::ScopedFD());
      } else {
        read_active_.Run(base::BindOnce(&DrmInputOpens::OnSessionActive,
                                        weak_factory_.GetWeakPtr(), number));
      }
    }
  } else {
    LOG(ERROR) << "logind refused device " << number.major << ":"
               << number.minor << " for " << pending.current.path.value();
    Finish(number, base::ScopedFD());
  }
}

void DrmInputOpens::OnSessionActive(DeviceNumber number, bool active) {
  auto& pending = pending_.at(number);
  if (!IsCurrent(pending)) {
    Cleanup(number);
  } else if (active) {
    LOG(ERROR) << "logind handed over " << pending.current.path.value() << " ("
               << number.major << ":" << number.minor
               << ") revoked while saying this session is active; taking it "
                  "again because no Active edge will arrive";
    ++pending.attempt;
    Begin(number);
  } else {
    VLOG(1) << "domicile: input device " << pending.current.path.value()
            << " is revoked while inactive; taking it again on activation";
    Finish(number, base::ScopedFD());
  }
}

void DrmInputOpens::Cleanup(DeviceNumber number) {
  auto& pending = pending_.at(number);
  pending.recorded = false;
  pending.cleaning = true;
  // A newer Take must wait: releasing an old reply after it would revoke
  // the newer claim, since logind identifies both by the same device number.
  devices_->ReleaseCanceled(number, pending.current.path,
                            base::BindOnce(&DrmInputOpens::OnReleased,
                                           weak_factory_.GetWeakPtr(), number));
}

void DrmInputOpens::OnReleased(DeviceNumber number, bool agreed) {
  pending_.at(number).cleaning = false;
  Finish(number, base::ScopedFD(), agreed);
}

void DrmInputOpens::Finish(DeviceNumber number,
                           base::ScopedFD descriptor,
                           bool may_begin) {
  auto& pending = pending_.at(number);
  CHECK(pending.busy);
  std::move(pending.current.opened).Run(std::move(descriptor));
  if (!may_begin) {
    while (pending.queued) {
      Opened queued = std::move(pending.queued->opened);
      pending.queued.reset();
      std::move(queued).Run(base::ScopedFD());
    }
    pending.busy = false;
  } else if (pending.queued) {
    Request next = std::move(*pending.queued);
    pending = Pending{std::move(next)};
    Begin(number);
  } else {
    pending.busy = false;
  }
}

}  // namespace ui
