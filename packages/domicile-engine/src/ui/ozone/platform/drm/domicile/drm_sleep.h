// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_SLEEP_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_SLEEP_H_

#include <string>

#include "base/memory/raw_ptr.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "dbus/bus.h"
#include "dbus/message.h"

namespace ui {

class DrmModeset;

// Whether a `PrepareForSleep` signal marks the end of a sleep.
//
// logind sends `false` after every sleep, including a failed one, so treat it
// as "the hardware may have been reset". A spurious relight costs one modeset.
//
// The argument is a plain `b` in the signal body, not a variant like a
// property, so a property reader would read nothing. A free function so it
// can be tested without a bus.
bool SleepEnded(dbus::Signal* signal);

// Relights the screens when the machine wakes from sleep.
//
// logind does not pause devices or drop DRM master across a suspend, so there
// is no pre-sleep work and no inhibitor. Only the GPU state is lost. The
// connectors report the same as before, so `DrmModeset` would skip the
// modeset; `DrmModeset::Relight` forces it. See docs/TTY-SESSION.md#suspend.
//
// `PrepareForSleep` is a machine-wide manager signal, so no session lookup is
// needed. CI cannot suspend; see docs/HARDWARE-CHECKS.md#suspend-and-resume.
class DrmSleep {
 public:
  // `modeset` must outlive this. `OzonePlatformDrm` declares this after it,
  // so this is destroyed first.
  explicit DrmSleep(DrmModeset* modeset);

  DrmSleep(const DrmSleep&) = delete;
  DrmSleep& operator=(const DrmSleep&) = delete;

  ~DrmSleep();

 private:
  void OnPrepareForSleep(dbus::Signal* signal);
  void OnSubscribed(const std::string& interface,
                    const std::string& signal,
                    bool connected);

  const raw_ptr<DrmModeset> modeset_;  // Not owned; outlives this.
  scoped_refptr<dbus::Bus> bus_;
  base::WeakPtrFactory<DrmSleep> weak_factory_{this};
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_SLEEP_H_
