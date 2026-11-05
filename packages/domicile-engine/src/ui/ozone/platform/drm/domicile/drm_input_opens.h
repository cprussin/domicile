// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_INPUT_OPENS_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_INPUT_OPENS_H_

#include <map>
#include <optional>

#include "base/functional/callback.h"
#include "base/memory/raw_ref.h"
#include "base/memory/weak_ptr.h"
#include "ui/ozone/platform/drm/domicile/drm_input_devices.h"
#include "ui/ozone/platform/drm/domicile/drm_logind_session.h"

namespace ui {

using TakeInputDeviceCall =
    base::RepeatingCallback<void(DeviceNumber, TakeAnswer)>;
using ReadSessionActiveCall =
    base::RepeatingCallback<void(base::OnceCallback<void(bool)>)>;

// Serializes a device's logind claims and cancels obsolete descriptor replies.
class DrmInputOpens {
 public:
  using Opened = base::OnceCallback<void(base::ScopedFD)>;

  DrmInputOpens(DrmTakenDevices& devices,
                TakeInputDeviceCall take,
                ReadSessionActiveCall read_active);
  ~DrmInputOpens();

  void Open(DeviceNumber number,
            int id,
            const base::FilePath& path,
            base::RepeatingCallback<bool()> is_current,
            Opened opened);
  bool CanResume(DeviceNumber number) const;

 private:
  struct Request {
    int id;
    base::FilePath path;
    base::RepeatingCallback<bool()> is_current;
    Opened opened;
  };
  struct Pending {
    Request current;
    std::optional<Request> queued;
    bool busy = true;
    bool cleaning = false;
    bool recorded = false;
    int attempt = 0;
  };

  bool IsCurrent(const Pending& pending) const;
  void Begin(DeviceNumber number);
  void OnTaken(DeviceNumber number, std::optional<TakenDevice> taken);
  void OnSessionActive(DeviceNumber number, bool active);
  void Cleanup(DeviceNumber number);
  void OnReleased(DeviceNumber number, bool agreed);
  void Finish(DeviceNumber number,
              base::ScopedFD descriptor,
              bool may_begin = true);

  const raw_ref<DrmTakenDevices> devices_;
  const TakeInputDeviceCall take_;
  const ReadSessionActiveCall read_active_;
  std::map<DeviceNumber, Pending> pending_;
  base::WeakPtrFactory<DrmInputOpens> weak_factory_{this};
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_INPUT_OPENS_H_
