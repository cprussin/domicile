// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_VT_SWITCHER_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_VT_SWITCHER_H_

#include <memory>

#include "base/files/file_descriptor_watcher_posix.h"
#include "base/files/scoped_file.h"
#include "base/memory/weak_ptr.h"
#include "ui/display/types/native_display_delegate.h"

namespace ui {

// What the kernel asked for, or what an asynchronous answer brought back.
enum class VtEvent {
  // The kernel's `relsig`: somebody pressed Ctrl+Alt+F2 and the console is
  // being taken away. We are asked, not told -- the switch does not happen
  // until `VT_RELDISP`.
  kReleaseRequested,
  // `NativeDisplayDelegate::RelinquishDisplayControl` answered.
  kRelinquishFinished,
  // The kernel's `acqsig`: the console is ours again. This one is a statement
  // rather than a question; the switch has already happened.
  kAcquireRequested,
  // `NativeDisplayDelegate::TakeDisplayControl` answered.
  kTakeFinished,
};

// Where the switcher is between having the console and not.
enum class VtState {
  // Console and DRM master, which is the ordinary running state.
  kOwned,
  // A release was asked for and the delegate has not answered yet.
  kReleasing,
  // Somebody else has the console.
  kReleased,
  // The console came back and the delegate has not answered yet.
  kAcquiring,
  // THE STATE THAT KEEPS A USER OFF A BLACK SCREEN. The console is ours and
  // DRM master is not, because taking it back failed. Nothing will draw, so
  // the only thing that matters here is that the next switch away is allowed
  // immediately rather than attempted through a delegate that has already
  // said no. Without this state that switch would be refused and the console
  // would be stuck on a display nothing can paint.
  kConsoleWithoutDisplay,
};

// What to do about it.
enum class VtAction {
  kNothing,
  // Ask the delegate to drop DRM master.
  kRelinquishDisplay,
  // `VT_RELDISP(1)`: let the switch proceed.
  kAllowSwitch,
  // `VT_RELDISP(0)`: refuse it, because we still hold the display.
  kRefuseSwitch,
  // Ask the delegate to take DRM master back.
  kTakeDisplay,
  // `VT_RELDISP(VT_ACKACQ)`: acknowledge that we have the console.
  kAckAcquire,
};

struct VtStep {
  VtState state;
  VtAction action;
};

// One step of the VT handshake, as arithmetic rather than as ioctls.
//
// This is a free function for the reason `ModesetParamsFromSnapshots` is one:
// what surrounds it -- a tty, two signals, a self-pipe and an asynchronous
// delegate -- is wiring that only a real console exercises, while the order of
// the handshake is where a mistake costs somebody their screen. Every decision
// worth arguing about is in this table and every one of them has a test.
//
// TWO ORDERINGS, AND THEY ARE NOT THE SAME. `console_ioctl(2)` says a process
// handling `relsig` releases its resources and *then* calls `VT_RELDISP` to
// allow or refuse; a process handling `acqsig` acquires its resources and
// *then* calls `VT_RELDISP(VT_ACKACQ)`. So release is delegate-then-ioctl and
// acquire is also delegate-then-ioctl -- the asymmetry is that release may say
// no and acquire may not, because on `acqsig` the switch has already happened.
//
// `succeeded` is read only for the two `*Finished` events and ignored
// otherwise.
VtStep StepVtSwitch(VtState state, VtEvent event, bool succeeded);

// Hands the console back on Ctrl+Alt+F<n>, and takes it when it returns.
//
// The seams this drives are all ungated and all upstream:
// `NativeDisplayDelegate::RelinquishDisplayControl` reaches
// `DrmWrapper::DropMaster` through `DrmDisplayHostManager` and the DRM thread,
// and `TakeDisplayControl` reaches `SetMaster` the same way. What did not
// exist off ChromeOS is a caller, because on ChromeOS the session manager owns
// the VT and `ash` never asks. This is that caller and nothing more.
//
// WHAT IT DOES NOT DO, said here because it is the first thing somebody will
// expect of it: it does not rescue a wedged engine. `VT_SETMODE`'s handshake
// runs in this process, so a browser that is stuck in a GPU wait never answers
// `relsig`, never calls `VT_RELDISP`, and the kernel refuses the switch. A
// browser that *dies* is fine without any of this -- the kernel drops DRM
// master when the fd closes and switches anyway, because the process that
// asked for `VT_PROCESS` is gone. So this makes a working desktop usable; it
// is not a recovery mechanism.
//
// Input is the other half and is not here. Until the evdev fds are revoked on
// the same two edges, keystrokes typed at another VT still reach this one --
// `A-DESKTOP-ON-A-TTY.md` carries that as its own item.
class DrmVtSwitcher {
 public:
  // `delegate` must outlive this. `tty` is an open fd on the console this
  // process is running on -- `/dev/tty` of the session, not `/dev/tty0`, which
  // is whichever VT is active rather than ours.
  DrmVtSwitcher(std::unique_ptr<display::NativeDisplayDelegate> delegate,
                base::ScopedFD tty);

  DrmVtSwitcher(const DrmVtSwitcher&) = delete;
  DrmVtSwitcher& operator=(const DrmVtSwitcher&) = delete;

  // Restores `VT_AUTO`, so a console this process was handling is left in the
  // mode it was found in. Skipping this would leave the VT expecting a
  // handshake from a process that is exiting.
  ~DrmVtSwitcher();

  // Installs the signal handlers and puts the tty in `VT_PROCESS`. Returns
  // false and changes nothing if either fails, because a half-installed
  // handshake is worse than none: the kernel would wait for an acknowledgement
  // nothing sends.
  bool Start();

  VtState state_for_testing() const { return state_; }

 private:
  // One event, and whatever the table says to do about it.
  void Handle(VtEvent event, bool succeeded);
  void Perform(VtAction action);
  // Reads the byte the signal handler wrote and turns it into an event. A
  // signal handler may do almost nothing, so it writes and this reads.
  void OnSignalPipeReadable();

  std::unique_ptr<display::NativeDisplayDelegate> delegate_;
  base::ScopedFD tty_;
  std::unique_ptr<base::FileDescriptorWatcher::Controller> watch_;
  VtState state_ = VtState::kOwned;
  bool installed_ = false;
  base::WeakPtrFactory<DrmVtSwitcher> weak_factory_{this};
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_VT_SWITCHER_H_
