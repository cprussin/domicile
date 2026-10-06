// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_VT_SWITCHER_H_
#define UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_VT_SWITCHER_H_

#include <stdint.h>

#include <memory>
#include <optional>
#include <string>

#include "base/memory/raw_ptr.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "dbus/bus.h"
#include "dbus/message.h"
#include "dbus/object_path.h"
#include "dbus/object_proxy.h"
#include "ui/display/types/native_display_delegate.h"
#include "ui/events/event.h"
#include "ui/events/platform/platform_event_observer.h"
#include "ui/events/platform/platform_event_source.h"

namespace ui {

class DrmModeset;

// Returns the console a `Ctrl+Alt+F<n>` press asks for, or nothing.
//
// Matches exactly Ctrl and Alt, so shells can still bind chords such as
// `Ctrl+Alt+Shift+F1`.
std::optional<uint32_t> VtForChord(const KeyEvent& event);

// Parses the seat path from logind's `(so)` reply to a `Get` of
// `Session.Seat`. Returns nothing for a session on no seat.
//
// The seat is read from the session, not hardcoded. logind resolves
// `seat/self` through the caller's credentials and answers `UnknownObject`
// on a real tty, and `seat0` is wrong on multi-seat machines.
//
// logind reports "no seat" as `("", "/")`. `/` is a valid object path, so
// it is rejected here rather than failing later in `SwitchTo`.
std::optional<dbus::ObjectPath> SeatOfSession(dbus::MessageReader* reader);

// An input to the switch state machine.
enum class VtEvent {
  // The session's `Active` went false. logind has already switched away, so
  // there is nothing to refuse.
  kSessionDeactivated,
  // `NativeDisplayDelegate::RelinquishDisplayControl` answered.
  kRelinquishFinished,
  // The session's `Active` went true.
  kSessionActivated,
  // `NativeDisplayDelegate::TakeDisplayControl` answered.
  kTakeFinished,
};

// Whether the switcher holds the display.
enum class VtState {
  // Active and holding DRM master. The normal state.
  kForeground,
  // Waiting for the delegate to drop DRM master.
  kRelinquishing,
  // Another console is active.
  kBackground,
  // Waiting for the delegate to take DRM master back.
  kTaking,
  // Active, but taking DRM master back failed, so nothing draws. The next
  // activation retries the take, and the next deactivation skips the drop.
  kForegroundWithoutDisplay,
};

// What the switcher does in response to a `VtEvent`.
enum class VtAction {
  kNothing,
  // Ask the delegate to drop DRM master.
  kRelinquishDisplay,
  // Ask the delegate to take DRM master back.
  kTakeDisplay,
  // Modeset every connector again after taking DRM master back.
  //
  // Whoever held the console meanwhile reprogrammed the CRTCs, so page flips
  // against the old state are refused. `PageFlipWatchdog` then crashes the
  // GPU process after 15 seconds unless a modeset happens. The connectors
  // look unchanged, so only `DrmModeset::Relight` forces one. See
  // `domicile/drm_modeset.h`.
  kRelightDisplay,
};

struct VtStep {
  VtState state;
  VtAction action;
};

// Advances the switch state machine by one event.
//
// A free function so the ordering can be unit tested without D-Bus or a
// real console.
//
// `Active` can flip twice before the delegate answers once, so each answer
// is read against the current state. A take that finishes after the session
// left drops the display again; a drop that finishes after it returned takes
// it again.
//
// `succeeded` is read only for `kTakeFinished`. A failed drop changes
// nothing, since logind switches regardless and the next take recovers.
//
// Only a successful take relights. A modeset from any other state would
// commit over another console's frame.
VtStep StepVtSwitch(VtState state, VtEvent event, bool succeeded);

// Handles `Ctrl+Alt+F<n>` and drops or retakes the display as the session's
// `Active` property changes. Design: docs/TTY-SESSION.md#console-switching.
//
// logind's `TakeControl` disables the kernel's own chord (`K_OFF`), so this
// binds it and calls `Seat.SwitchTo`. It must not call `VT_SETMODE`: that
// silently replaces logind's VT handshake and breaks switching.
//
// The chord is read in `WillProcessEvent` because the compositor reads no
// evdev nodes; all keys arrive here first, ahead of any dispatcher or nested
// run loop.
//
// The card is not a logind device, so no `PauseDevice` arrives for it. The
// display follows `Active` instead, one D-Bus round trip after the switch.
class DrmVtSwitcher : public PlatformEventObserver {
 public:
  // `events` and `modeset` must outlive this. `OzonePlatformDrm` creates both
  // before this switcher.
  DrmVtSwitcher(std::unique_ptr<display::NativeDisplayDelegate> delegate,
                PlatformEventSource* events,
                DrmModeset* modeset);

  DrmVtSwitcher(const DrmVtSwitcher&) = delete;
  DrmVtSwitcher& operator=(const DrmVtSwitcher&) = delete;

  ~DrmVtSwitcher() override;

  // PlatformEventObserver:
  void WillProcessEvent(const PlatformEvent& event) override;
  void DidProcessEvent(const PlatformEvent& event) override;

 private:
  // Handles logind's `GetSessionByPID` reply.
  void OnSessionFound(dbus::Response* response);
  // Looks up the session's seat, which receives `SwitchTo`.
  void ReadSeat();
  void OnSeatFound(dbus::Response* response);
  // Asks logind to switch to `console`.
  void SwitchTo(uint32_t console);
  // Rereads `Active` on any change, since logind may report it in either the
  // changed dictionary or the invalidated list.
  void OnPropertiesChanged(dbus::Signal* signal);
  void OnSubscribed(const std::string& interface,
                    const std::string& signal,
                    bool connected);
  void ReadActive();
  void OnActive(dbus::Response* response);

  // Steps the state machine and performs the resulting action.
  void Handle(VtEvent event, bool succeeded);
  void Perform(VtAction action);

  std::unique_ptr<display::NativeDisplayDelegate> delegate_;
  raw_ptr<PlatformEventSource> events_;
  const raw_ptr<DrmModeset> modeset_;  // Not owned; outlives this.
  scoped_refptr<dbus::Bus> bus_;
  raw_ptr<dbus::ObjectProxy> session_ = nullptr;
  // Null until logind reports the seat, two round trips after construction.
  raw_ptr<dbus::ObjectProxy> seat_ = nullptr;
  // A console requested before the seat was known; sent once it is.
  std::optional<uint32_t> pending_console_;
  VtState state_ = VtState::kForeground;
  base::WeakPtrFactory<DrmVtSwitcher> weak_factory_{this};
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_VT_SWITCHER_H_
