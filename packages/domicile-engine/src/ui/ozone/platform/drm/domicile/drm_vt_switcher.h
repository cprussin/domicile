// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

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

// The console this chord asks for, or nothing.
//
// `Ctrl+Alt+F<n>` and exactly that: both modifiers and neither more nor less,
// on the press rather than the release. A shell is free to grab
// `Ctrl+Alt+Shift+F1`, and finding the console switch out from under it would
// be the kind of collision a desktop cannot explain.
std::optional<uint32_t> VtForChord(const KeyEvent& event);

// The seat this session is on, out of the `(so)` logind answers a `Get` of
// `org.freedesktop.login1.Session.Seat` with: the seat's id and its object
// path. Nothing is answered for a session that is on no seat.
//
// READ RATHER THAN SPELLED, AND THAT IS THE WHOLE POINT OF IT.
// `/org/freedesktop/login1/seat/self` is what `Seat.SwitchTo` used to be sent
// to, and on a real tty logind answered `UnknownObject`: `self` is not a name
// it stores anywhere, it is a lookup -- `seat_object_find` resolves it through
// the sending connection's own credentials to a session and then to that
// session's seat, and answers "no such object" whichever half comes up empty.
// The session object is already in hand from `GetSessionByPID`, so its own
// `Seat` names the seat this session is actually on, off a path logind gave
// us rather than one we guessed. `seat0` written out here would be the other
// way to be wrong, on the second seat of any machine that has one.
//
// A SESSION ON NO SEAT IS ANSWERED `("", "/")`, and `/` is a perfectly
// well-formed object path -- so it would travel all the way to a `SwitchTo`
// and fail there as cryptically as the alias did. It is not a seat, and this
// says so instead.
std::optional<dbus::ObjectPath> SeatOfSession(dbus::MessageReader* reader);

// What logind said, or what an asynchronous answer brought back.
enum class VtEvent {
  // The session's `Active` went false: somebody switched to another console
  // and logind has already handed it over. This is a statement, not a
  // question -- unlike the kernel's `relsig`, which this used to answer, there
  // is nothing left to refuse.
  kSessionDeactivated,
  // `NativeDisplayDelegate::RelinquishDisplayControl` answered.
  kRelinquishFinished,
  // The session's `Active` went true: this console is in front of the user
  // again.
  kSessionActivated,
  // `NativeDisplayDelegate::TakeDisplayControl` answered.
  kTakeFinished,
};

// Where the switcher is between having the display and not.
enum class VtState {
  // In front of the user with DRM master, which is the ordinary running state.
  kForeground,
  // A drop was asked for and the delegate has not answered yet.
  kRelinquishing,
  // Somebody else's console is on the panel.
  kBackground,
  // The console came back and the delegate has not answered yet.
  kTaking,
  // THE STATE THAT KEEPS A USER OFF A BLACK SCREEN. The session is in front of
  // the user and DRM master is not ours, because taking it back failed.
  // Nothing will draw, so what this state is for is that the next activation
  // asks again rather than believing a display it does not have -- and that
  // the next deactivation asks for nothing, since a drop of what we do not
  // hold is a round trip that can only fail.
  kForegroundWithoutDisplay,
};

// What to do about it.
enum class VtAction {
  kNothing,
  // Ask the delegate to drop DRM master.
  kRelinquishDisplay,
  // Ask the delegate to take DRM master back.
  kTakeDisplay,
};

struct VtStep {
  VtState state;
  VtAction action;
};

// One step of following the session, as arithmetic rather than as D-Bus.
//
// This is a free function for the reason `ModesetParamsFromSnapshots` is one:
// what surrounds it -- a bus, a session proxy and an asynchronous delegate --
// is wiring that only a real console exercises, while the order is where a
// mistake costs somebody their screen. Every decision worth arguing about is
// in this table and every one of them has a test.
//
// THE TWO RACES ARE THE WHOLE REASON THIS IS A TABLE. `Active` can flip twice
// before the display delegate answers once -- a console switched away from and
// straight back to does exactly that -- so an answer has to be read against
// where the session is now rather than where it was when the question was
// asked. A take that lands after the session left gives the display straight
// back; a drop that lands after it returned asks for it again.
//
// `succeeded` is read only for `kTakeFinished`. A relinquish that failed
// changes nothing here: logind owns the handshake and hands the console over
// on its own schedule, so there is no refusing a switch, and the way out of a
// display that would not drop is the take on the way back.
VtStep StepVtSwitch(VtState state, VtEvent event, bool succeeded);

// Ctrl+Alt+F<n>, and the display following the console it moves.
//
// LOGIND OWNS THE VT AND THIS DOES NOT ARGUE WITH IT. `TakeControl` -- which
// `DrmLogindInput` calls, and must, because no ACL covers a keyboard -- runs
// logind's `session_prepare_vt`: `K_OFF`, `KD_GRAPHICS` and `VT_PROCESS` with
// logind's own signals. Two consequences, and this class exists for both.
//
// The first is that the kernel's own `Ctrl+Alt+F<n>` is off, because `K_OFF`
// is what turns it off. From that moment the only process that can start a
// console switch is this one, which is why every Wayland compositor binds the
// chord itself and calls `Seat.SwitchTo`. Until it was bound here the chord
// did nothing at all.
//
// The second is that a `VT_SETMODE` of our own would be a theft rather than a
// conflict. The kernel overwrites `vt_mode` and `vt_pid` without an `EBUSY`,
// so the handshake logind installed would simply stop being logind's: it would
// never get its release signal, never pause the devices it lent this session,
// and never hand the console over. That is what this used to do, and removing
// it is half of what makes the switch work.
//
// WHERE THE CHORD IS READ, AND WHY IT IS HERE RATHER THAN IN THE COMPOSITOR.
// The compositor advertises a `wl_seat` to its clients and reads no evdev node
// at all -- it pulls neither libinput nor a session backend, by a decision its
// `Cargo.toml` records -- so every key in the desktop arrives through this
// process's evdev thread and is dispatched by `EventFactoryEvdev`, which is a
// `PlatformEventSource`. `WillProcessEvent` is the first thing that runs on a
// key, ahead of every dispatcher and of any nested run loop's override, which
// is what makes it the one place a console switch cannot be starved out of.
//
// THE DISPLAY FOLLOWS `Active`, AND NOT A SIGNAL OF OURS. The card is not one
// of logind's devices -- the browser opens `/dev/dri/card*` itself, through
// the ACL `70-uaccess.rules` does put on it -- so no `PauseDevice` ever
// arrives for it and there is nothing to answer with `PauseDeviceComplete`.
// What is left is the session's own `Active` property, which is a statement
// about a switch logind has already made. So the drop is late by the width of
// one D-Bus round trip, and the console is stale for that long rather than
// black: the kernel restores its own framebuffer when the last master goes.
// Taking the card from logind too is what would close that gap, and
// `A-DESKTOP-ON-A-TTY.md` carries it as its own item.
class DrmVtSwitcher : public PlatformEventObserver {
 public:
  // `events` must outlive this, and does: `OzonePlatformDrm` builds the event
  // factory in `InitializeUI` and this in `InitScreen`, so this is destroyed
  // first. Everything else is asynchronous and starts here.
  DrmVtSwitcher(std::unique_ptr<display::NativeDisplayDelegate> delegate,
                PlatformEventSource* events);

  DrmVtSwitcher(const DrmVtSwitcher&) = delete;
  DrmVtSwitcher& operator=(const DrmVtSwitcher&) = delete;

  ~DrmVtSwitcher() override;

  // PlatformEventObserver:
  void WillProcessEvent(const PlatformEvent& event) override;
  void DidProcessEvent(const PlatformEvent& event) override;

 private:
  // logind answered `GetSessionByPID`; from here on there is a session to
  // follow.
  void OnSessionFound(dbus::Response* response);
  // Which seat that session is on, which is the object a chord is sent to.
  void ReadSeat();
  void OnSeatFound(dbus::Response* response);
  // Ask logind for the console the chord named.
  void SwitchTo(uint32_t console);
  // Every property of the session, because `Active` is the only one worth
  // reading and reading it is cheaper than deciding whether this message
  // carried it -- logind may name a changed property in either the dictionary
  // or the invalidated list.
  void OnPropertiesChanged(dbus::Signal* signal);
  void OnSubscribed(const std::string& interface,
                    const std::string& signal,
                    bool connected);
  void ReadActive();
  void OnActive(dbus::Response* response);

  // One event, and whatever the table says to do about it.
  void Handle(VtEvent event, bool succeeded);
  void Perform(VtAction action);

  std::unique_ptr<display::NativeDisplayDelegate> delegate_;
  raw_ptr<PlatformEventSource> events_;
  scoped_refptr<dbus::Bus> bus_;
  raw_ptr<dbus::ObjectProxy> session_ = nullptr;
  // Null until logind has answered which seat this session is on, which is two
  // round trips after construction and cannot be waited for on this thread.
  raw_ptr<dbus::ObjectProxy> seat_ = nullptr;
  // THE CHORD THAT BEAT THE ANSWER. A console asked for before the seat is
  // known is remembered rather than dropped: the user pressed the keys, and
  // the console they named is still the one they want a round trip later.
  std::optional<uint32_t> pending_console_;
  VtState state_ = VtState::kForeground;
  base::WeakPtrFactory<DrmVtSwitcher> weak_factory_{this};
};

}  // namespace ui

#endif  // UI_OZONE_PLATFORM_DRM_DOMICILE_DRM_VT_SWITCHER_H_
