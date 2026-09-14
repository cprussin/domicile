// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_vt_switcher.h"

#include <linux/vt.h>
#include <signal.h>
#include <sys/ioctl.h>
#include <unistd.h>

#include <utility>

#include "base/files/scoped_file.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/posix/eintr_wrapper.h"

namespace ui {

namespace {

// The signals the kernel raises for this tty. `VT_SETMODE` lets a process pick
// them, and these are the conventional pair -- nothing under `base/` or `ui/`
// at this pin installs a handler for either, which was checked rather than
// assumed. If something ever does, these two lines are the whole change: the
// handshake does not care which signals carry it.
constexpr int kReleaseSignal = SIGUSR1;
constexpr int kAcquireSignal = SIGUSR2;

// A SIGNAL HANDLER MAY DO ALMOST NOTHING, so it writes one byte and the message
// loop does the rest. `write` to a pipe is on the async-signal-safe list; a
// delegate call, a log line and an ioctl are not. These are namespace-scope
// because a signal handler has no other way to reach anything, and `Start()`
// refuses a second switcher rather than let one clobber the other's pipe.
int g_pipe_read = -1;
int g_pipe_write = -1;

void OnVtSignal(int raised) {
  const char byte = raised == kReleaseSignal ? 'r' : 'a';
  // Deliberately unchecked. A full pipe means the reader has not drained the
  // wake it already has, and there is nothing a signal handler could do about
  // a failure in any case.
  const ssize_t ignored = write(g_pipe_write, &byte, 1);
  (void)ignored;
}

bool SetHandler(int raised, void (*handler)(int)) {
  struct sigaction action = {};
  action.sa_handler = handler;
  sigemptyset(&action.sa_mask);
  // No SA_RESTART: the handler writes one byte and returns, and a syscall
  // interrupted by it is one the message loop will retry.
  action.sa_flags = 0;
  return sigaction(raised, &action, nullptr) == 0;
}

}  // namespace

VtStep StepVtSwitch(VtState state, VtEvent event, bool succeeded) {
  // One assignment per decision and one return at the end, rather than a
  // return per branch: a switch over an enum that returns from every case
  // still reads as falling off the end to the compiler, and the warning it
  // raises is one this tree turns into an error.
  VtStep step = {state, VtAction::kNothing};

  switch (event) {
    case VtEvent::kReleaseRequested:
      switch (state) {
        case VtState::kOwned:
          step = {VtState::kReleasing, VtAction::kRelinquishDisplay};
          break;
        case VtState::kReleasing:
          // An answer is already in flight and will acknowledge for both.
          break;
        case VtState::kAcquiring:
          // The console came back and is being taken away again before the
          // delegate answered. Let it go -- the take still in flight will find
          // `kReleased` and change nothing, and refusing here would wedge
          // whoever asked for the switch.
          step = {VtState::kReleased, VtAction::kAllowSwitch};
          break;
        case VtState::kReleased:
        case VtState::kConsoleWithoutDisplay:
          // Nothing is owed, so nothing is waited for.
          step = {VtState::kReleased, VtAction::kAllowSwitch};
          break;
      }
      break;

    case VtEvent::kRelinquishFinished:
      if (state == VtState::kReleasing) {
        step = succeeded
                   ? VtStep{VtState::kReleased, VtAction::kAllowSwitch}
                   : VtStep{VtState::kOwned, VtAction::kRefuseSwitch};
      }
      break;

    case VtEvent::kAcquireRequested:
      switch (state) {
        case VtState::kReleased:
          step = {VtState::kAcquiring, VtAction::kTakeDisplay};
          break;
        case VtState::kAcquiring:
          break;
        case VtState::kOwned:
        case VtState::kConsoleWithoutDisplay:
        case VtState::kReleasing:
          // The kernel is waiting for an acknowledgement, and silence is the
          // one answer it cannot use.
          step = {state, VtAction::kAckAcquire};
          break;
      }
      break;

    case VtEvent::kTakeFinished:
      if (state == VtState::kAcquiring) {
        step = succeeded ? VtStep{VtState::kOwned, VtAction::kAckAcquire}
                         : VtStep{VtState::kConsoleWithoutDisplay,
                                  VtAction::kAckAcquire};
      }
      break;
  }

  return step;
}

DrmVtSwitcher::DrmVtSwitcher(
    std::unique_ptr<display::NativeDisplayDelegate> delegate,
    base::ScopedFD tty)
    : delegate_(std::move(delegate)), tty_(std::move(tty)) {}

DrmVtSwitcher::~DrmVtSwitcher() {
  if (!installed_) {
    return;
  }
  // Back to the mode it was found in. A VT left in `VT_PROCESS` is waiting on
  // a handshake from a process that is exiting; the kernel does eventually
  // notice the pid is gone and switch anyway, but "eventually" is a thing
  // somebody sits through.
  struct vt_mode mode = {};
  mode.mode = VT_AUTO;
  if (ioctl(tty_.get(), VT_SETMODE, &mode) != 0) {
    PLOG(ERROR) << "could not restore VT_AUTO; this console may need a chvt";
  }
  SetHandler(kReleaseSignal, SIG_DFL);
  SetHandler(kAcquireSignal, SIG_DFL);
  watch_.reset();
  close(g_pipe_read);
  close(g_pipe_write);
  g_pipe_read = -1;
  g_pipe_write = -1;
}

bool DrmVtSwitcher::Start() {
  if (g_pipe_write != -1) {
    LOG(ERROR) << "a VT switcher is already installed; there is one console";
    return false;
  }

  int fds[2] = {-1, -1};
  if (pipe(fds) != 0) {
    PLOG(ERROR) << "no pipe for the VT signal handler";
    return false;
  }
  base::ScopedFD read_end(fds[0]);
  base::ScopedFD write_end(fds[1]);

  // HANDLERS BEFORE `VT_SETMODE`, and the order is the whole risk. A tty in
  // `VT_PROCESS` whose handler is not installed raises a signal whose default
  // action terminates the browser, and it would do it on the first
  // Ctrl+Alt+F2.
  g_pipe_read = read_end.get();
  g_pipe_write = write_end.get();
  if (!SetHandler(kReleaseSignal, OnVtSignal) ||
      !SetHandler(kAcquireSignal, OnVtSignal)) {
    PLOG(ERROR) << "could not install the VT signal handlers";
    SetHandler(kReleaseSignal, SIG_DFL);
    SetHandler(kAcquireSignal, SIG_DFL);
    g_pipe_read = g_pipe_write = -1;
    return false;
  }

  struct vt_mode mode = {};
  mode.mode = VT_PROCESS;
  mode.relsig = kReleaseSignal;
  mode.acqsig = kAcquireSignal;
  if (ioctl(tty_.get(), VT_SETMODE, &mode) != 0) {
    PLOG(ERROR) << "could not take VT_PROCESS on this console; switching away "
                   "will leave the display where it is";
    SetHandler(kReleaseSignal, SIG_DFL);
    SetHandler(kAcquireSignal, SIG_DFL);
    g_pipe_read = g_pipe_write = -1;
    return false;
  }

  watch_ = base::FileDescriptorWatcher::WatchReadable(
      g_pipe_read, base::BindRepeating(&DrmVtSwitcher::OnSignalPipeReadable,
                                       weak_factory_.GetWeakPtr()));
  // Only now, because the destructor undoes exactly what got installed and
  // every path above this line has already undone its own.
  std::ignore = read_end.release();
  std::ignore = write_end.release();
  installed_ = true;
  VLOG(1) << "VT switching is on; Ctrl+Alt+F<n> hands the display back";
  return true;
}

void DrmVtSwitcher::OnSignalPipeReadable() {
  char byte = 0;
  if (HANDLE_EINTR(read(g_pipe_read, &byte, 1)) != 1) {
    return;
  }
  Handle(byte == 'r' ? VtEvent::kReleaseRequested : VtEvent::kAcquireRequested,
         false);
}

void DrmVtSwitcher::Handle(VtEvent event, bool succeeded) {
  const VtStep step = StepVtSwitch(state_, event, succeeded);
  state_ = step.state;
  Perform(step.action);
}

void DrmVtSwitcher::Perform(VtAction action) {
  switch (action) {
    case VtAction::kNothing:
      return;
    case VtAction::kRelinquishDisplay:
      delegate_->RelinquishDisplayControl(base::BindOnce(
          [](base::WeakPtr<DrmVtSwitcher> self, bool ok) {
            if (self) {
              self->Handle(VtEvent::kRelinquishFinished, ok);
            }
          },
          weak_factory_.GetWeakPtr()));
      return;
    case VtAction::kTakeDisplay:
      delegate_->TakeDisplayControl(base::BindOnce(
          [](base::WeakPtr<DrmVtSwitcher> self, bool ok) {
            if (self) {
              self->Handle(VtEvent::kTakeFinished, ok);
            }
          },
          weak_factory_.GetWeakPtr()));
      return;
    case VtAction::kAllowSwitch:
      if (ioctl(tty_.get(), VT_RELDISP, 1) != 0) {
        PLOG(ERROR) << "could not allow the VT switch";
      }
      return;
    case VtAction::kRefuseSwitch:
      LOG(ERROR) << "refusing a VT switch: the display could not be released, "
                    "so handing the console over would leave two owners on one "
                    "CRTC";
      if (ioctl(tty_.get(), VT_RELDISP, 0) != 0) {
        PLOG(ERROR) << "could not refuse the VT switch";
      }
      return;
    case VtAction::kAckAcquire:
      if (ioctl(tty_.get(), VT_RELDISP, VT_ACKACQ) != 0) {
        PLOG(ERROR) << "could not acknowledge the VT switch";
      }
      return;
  }
}

}  // namespace ui
