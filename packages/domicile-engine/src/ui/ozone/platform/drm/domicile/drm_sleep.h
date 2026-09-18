// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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

// Whether this `PrepareForSleep` is the machine coming back.
//
// logind broadcasts `true` on the way down and `false` once the sleep is over,
// and it emits the `false` even for a sleep that failed -- so this is read as
// "the hardware may have been reset", which is the only claim a display driver
// can act on. Acting on it when nothing was suspended costs one modeset.
//
// READ AS A SIGNAL AND NOT AS A PROPERTY, which is the mistake this function
// exists to keep in one place. `Session.Active` next door arrives inside a
// variant because every property does; this one's body is a plain `b`. The
// property reader pops nothing off it, and a desktop that never lights again
// is the whole of what that looks like from the outside.
//
// A free function for the reason `SeatOfSession` is one: what surrounds it is
// a bus, and a bus is what only a real machine has.
bool SleepEnded(dbus::Signal* signal);

// The screens, lit again when the machine wakes up.
//
// WHAT A SUSPEND DOES NOT DO, WHICH IS ALMOST EVERYTHING. logind's
// `session_device_pause_all` and `session_device_resume_all` have three
// callers between them and every one is a VT path; `DROP_MASTER` is asked for
// in one place and it is that same path. So across a suspend the evdev
// descriptors this session took stay open, no `PauseDevice` arrives, DRM
// master is still this process's, and the session never leaves `Active`. There
// is nothing to hand back and nothing to take again -- which is why this holds
// no inhibitor: a delay inhibitor buys a window to do pre-sleep work in, and
// there is no pre-sleep work.
//
// WHAT IT DOES DO IS RESET THE GPU, and that is the one thing a driver has to
// answer for. The connectors come back reporting what they reported going
// down, so `DrmModeset`'s own loop guard -- which answers "the report has not
// changed, so asking again cannot help" and is right about every hotplug --
// would let the CRTCs stay dark. `DrmModeset::Relight` is the way past it and
// this is its only caller.
//
// ONE SIGNAL AND NO SESSION. `PrepareForSleep` is the manager's: one broadcast
// for the whole machine, so there is no `GetSessionByPID` here and nothing to
// wait two round trips for.
//
// REASONED FROM logind's SOURCES AND NOT YET RUN. No runner suspends, so
// nothing in CI reaches this path; what is tested is the reading of the signal
// and the relight it drives. `A-DESKTOP-ON-A-TTY.md` records it as such.
class DrmSleep {
 public:
  // `modeset` must outlive this, and does: `OzonePlatformDrm` builds both in
  // `InitScreen` and declares this after it, so this is destroyed first.
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
