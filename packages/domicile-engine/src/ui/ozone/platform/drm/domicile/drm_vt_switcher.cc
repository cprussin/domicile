// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "ui/ozone/platform/drm/domicile/drm_vt_switcher.h"

#include <utility>

#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/single_thread_task_runner_thread_mode.h"
#include "base/task/task_traits.h"
#include "base/task/thread_pool.h"
#include "dbus/object_path.h"
#include "ui/events/event_constants.h"
#include "ui/events/keycodes/keyboard_codes_posix.h"
#include "ui/events/types/event_type.h"
#include "ui/ozone/platform/drm/domicile/drm_modeset.h"

namespace ui {

namespace {

constexpr char kLogind[] = "org.freedesktop.login1";
constexpr char kManagerPath[] = "/org/freedesktop/login1";
constexpr char kManagerInterface[] = "org.freedesktop.login1.Manager";
constexpr char kSessionInterface[] = "org.freedesktop.login1.Session";
// THE SEAT RATHER THAN THE SESSION, because a chord names a console and not a
// session: `Session.Activate` can only raise a session already known by name,
// while `Seat.SwitchTo(u)` is "whoever is on VT 3". logind's shipped polkit
// policy gives `org.freedesktop.login1.chvt` `allow_active yes`, so an active
// session authenticates for none of this. WHICH seat is read off the session
// rather than written down here -- see `SeatOfSession`.
constexpr char kSeatInterface[] = "org.freedesktop.login1.Seat";

constexpr char kGetSessionByPID[] = "GetSessionByPID";
constexpr char kSwitchTo[] = "SwitchTo";

constexpr char kPropertiesInterface[] = "org.freedesktop.DBus.Properties";
constexpr char kPropertiesGet[] = "Get";
constexpr char kPropertiesChanged[] = "PropertiesChanged";
constexpr char kActive[] = "Active";
constexpr char kSeat[] = "Seat";

// What logind writes for the seat of a session that is on none. A valid object
// path, and not an object.
constexpr char kNoSeat[] = "/";

// The console the chord is on, counted from the key rather than mapped: the
// twelve function keys are contiguous and `Seat.SwitchTo` takes the number the
// user pressed.
constexpr int kConsoles = 12;

// The modifiers a console switch is spelled with, and the ones it is not.
// Matching on the whole mask rather than on two bits is what keeps
// `Ctrl+Alt+Shift+F1` somebody else's shortcut.
constexpr int kModifiers = EF_SHIFT_DOWN | EF_CONTROL_DOWN | EF_ALT_DOWN |
                           EF_COMMAND_DOWN | EF_ALTGR_DOWN;
constexpr int kConsoleChord = EF_CONTROL_DOWN | EF_ALT_DOWN;

}  // namespace

std::optional<uint32_t> VtForChord(const KeyEvent& event) {
  const bool named = event.type() == EventType::kKeyPressed &&
                     (event.flags() & kModifiers) == kConsoleChord &&
                     event.key_code() >= VKEY_F1 &&
                     event.key_code() < VKEY_F1 + kConsoles;
  return named ? std::optional<uint32_t>(
                     static_cast<uint32_t>(event.key_code() - VKEY_F1 + 1))
               : std::nullopt;
}

std::optional<dbus::ObjectPath> SeatOfSession(dbus::MessageReader* reader) {
  dbus::MessageReader variant(nullptr);
  dbus::MessageReader seat(nullptr);
  std::string id;
  dbus::ObjectPath path;
  if (!reader->PopVariant(&variant) || !variant.PopStruct(&seat) ||
      !seat.PopString(&id) || !seat.PopObjectPath(&path)) {
    LOG(FATAL) << "logind answered " << kSeat
               << " with something that is not a seat";
  }

  return path.value() == kNoSeat ? std::nullopt
                                 : std::optional<dbus::ObjectPath>(path);
}

VtStep StepVtSwitch(VtState state, VtEvent event, bool succeeded) {
  // One assignment per decision and one return at the end, rather than a
  // return per branch: a switch over an enum that returns from every case
  // still reads as falling off the end to the compiler, and the warning it
  // raises is one this tree turns into an error.
  VtStep step = {state, VtAction::kNothing};

  switch (event) {
    case VtEvent::kSessionDeactivated:
      switch (state) {
        case VtState::kForeground:
          step = {VtState::kRelinquishing, VtAction::kRelinquishDisplay};
          break;
        case VtState::kTaking:
          // Nothing is asked for: the take already in flight will find
          // `kBackground` and give the display straight back.
          step = {VtState::kBackground, VtAction::kNothing};
          break;
        case VtState::kForegroundWithoutDisplay:
          // There is no display to give back.
          step = {VtState::kBackground, VtAction::kNothing};
          break;
        case VtState::kRelinquishing:
        case VtState::kBackground:
          // A drop is already in flight, or already done.
          break;
      }
      break;

    case VtEvent::kRelinquishFinished:
      switch (state) {
        case VtState::kRelinquishing:
          // Succeeded or not, the session is in the background and there is no
          // switch left to refuse. A drop that failed is a display nobody can
          // paint on until the take on the way back.
          step = {VtState::kBackground, VtAction::kNothing};
          break;
        case VtState::kForeground:
          // The session came back while the drop was in flight, so the display
          // it dropped is one this console needs again.
          step = {VtState::kTaking, VtAction::kTakeDisplay};
          break;
        case VtState::kBackground:
        case VtState::kTaking:
        case VtState::kForegroundWithoutDisplay:
          // Nobody is waiting on this answer.
          break;
      }
      break;

    case VtEvent::kSessionActivated:
      switch (state) {
        case VtState::kBackground:
        case VtState::kForegroundWithoutDisplay:
          step = {VtState::kTaking, VtAction::kTakeDisplay};
          break;
        case VtState::kRelinquishing:
          // Asking now would race the drop already in flight; the answer to
          // that drop finds `kForeground` and asks for the display back.
          step = {VtState::kForeground, VtAction::kNothing};
          break;
        case VtState::kForeground:
        case VtState::kTaking:
          // Already in front, or already asking.
          break;
      }
      break;

    case VtEvent::kTakeFinished:
      switch (state) {
        case VtState::kTaking:
          // THE RELIGHT IS PART OF COMING BACK, not a separate event. The
          // card is programmable again and it is not programmed the way this
          // session left it; see `VtAction::kRelightDisplay`.
          step = succeeded
                     ? VtStep{VtState::kForeground, VtAction::kRelightDisplay}
                     : VtStep{VtState::kForegroundWithoutDisplay,
                              VtAction::kNothing};
          break;
        case VtState::kBackground:
          // THE ONE THAT WOULD BE THE TWO-OWNER BUG. The session left while
          // the take was in flight, so a take that succeeded is this process
          // holding DRM master on somebody else's console.
          if (succeeded) {
            step = {VtState::kRelinquishing, VtAction::kRelinquishDisplay};
          }
          break;
        case VtState::kForeground:
        case VtState::kRelinquishing:
        case VtState::kForegroundWithoutDisplay:
          // Nobody is waiting on this answer.
          break;
      }
      break;
  }

  return step;
}

DrmVtSwitcher::DrmVtSwitcher(
    std::unique_ptr<display::NativeDisplayDelegate> delegate,
    PlatformEventSource* events,
    DrmModeset* modeset)
    : delegate_(std::move(delegate)), events_(events), modeset_(modeset) {
  dbus::Bus::Options options;
  options.bus_type = dbus::Bus::SYSTEM;
  options.connection_type = dbus::Bus::PRIVATE;
  // A thread-pool worker installs a `FileDescriptorWatcher` for the scope
  // tasks run in, which is what the bus needs to watch its socket. The ORIGIN
  // thread is this one -- the browser's UI thread -- so every signal and every
  // answer below is delivered here, which is where a `NativeDisplayDelegate`
  // may be called and where a key is dispatched. Nothing on this class blocks.
  //
  // DEDICATED, BECAUSE THIS IS THE BUS THAT WAS BEING STARVED. Nothing here
  // blocking is not enough when something else on the same thread does:
  // `DrmLogindInput`'s calls are synchronous by necessity, and a shared runner
  // put its `CallMethodAndBlock` on the thread that pumps this socket. The
  // signal it delayed is the one that says the session went inactive -- which
  // is the only thing that starts the relinquish, and the thing standing
  // between a console switch and `PageFlipWatchdog` killing the GPU process
  // fifteen seconds later. See `domicile/drm_logind_input.cc`.
  options.dbus_task_runner = base::ThreadPool::CreateSingleThreadTaskRunner(
      {base::MayBlock(), base::TaskPriority::USER_BLOCKING},
      base::SingleThreadTaskRunnerThreadMode::DEDICATED);
  bus_ = base::MakeRefCounted<dbus::Bus>(std::move(options));

  dbus::ObjectProxy* manager =
      bus_->GetObjectProxy(kLogind, dbus::ObjectPath(kManagerPath));
  dbus::MethodCall find_session(kManagerInterface, kGetSessionByPID);
  dbus::MessageWriter writer(&find_session);
  // Zero is logind's word for "whoever is asking", answered from the D-Bus
  // sender's credentials -- so this needs neither `XDG_SESSION_ID` nor a pid
  // that means the same thing on both sides of a namespace.
  writer.AppendUint32(0);
  manager->CallMethod(&find_session, dbus::ObjectProxy::TIMEOUT_USE_DEFAULT,
                      base::BindOnce(&DrmVtSwitcher::OnSessionFound,
                                     weak_factory_.GetWeakPtr()));

  events_->AddPlatformEventObserver(this);
}

DrmVtSwitcher::~DrmVtSwitcher() {
  events_->RemovePlatformEventObserver(this);
  session_ = nullptr;
  seat_ = nullptr;
  // Blocking, on the thread that forbids it everywhere except here: this runs
  // as the ozone platform comes down, which is the same point
  // `dbus_thread_linux::ShutdownOnDBusThreadAndBlock` blocks the UI thread to
  // close the browser's shared buses.
  bus_->ShutdownOnDBusThreadAndBlock();
}

void DrmVtSwitcher::WillProcessEvent(const PlatformEvent& event) {
  if (!event->IsKeyEvent()) {
    return;
  }
  const std::optional<uint32_t> console = VtForChord(*event->AsKeyEvent());
  if (!console.has_value()) {
    return;
  }

  // THE SEAT IS TWO ROUND TRIPS AWAY AND A CHORD CAN BEAT THEM BOTH. Neither
  // may be waited for here: this is the thread every key in the desktop is
  // dispatched on. So a console asked for before logind has said which seat
  // this session is on is remembered, and `OnSeatFound` asks for it.
  if (seat_ == nullptr) {
    pending_console_ = console;
    return;
  }

  SwitchTo(*console);
}

// The chord is read on the way in and nothing is read on the way out, but the
// observer interface is two methods and one of them is pure virtual.
void DrmVtSwitcher::DidProcessEvent(const PlatformEvent&) {}

void DrmVtSwitcher::OnSessionFound(dbus::Response* response) {
  if (!response) {
    LOG(FATAL) << "logind does not know of a session for this process, so "
                  "Ctrl+Alt+F<n> would leave this desktop with no way out of "
                  "itself. Start Domicile from a logind session on a tty of "
                  "its own.";
  }

  dbus::MessageReader reader(response);
  dbus::ObjectPath session_path;
  if (!reader.PopObjectPath(&session_path)) {
    LOG(FATAL) << "logind answered " << kGetSessionByPID
               << " with something that is not a session";
  }
  session_ = bus_->GetObjectProxy(kLogind, session_path);

  ReadSeat();

  session_->ConnectToSignal(
      kPropertiesInterface, kPropertiesChanged,
      base::BindRepeating(&DrmVtSwitcher::OnPropertiesChanged,
                          weak_factory_.GetWeakPtr()),
      base::BindOnce(&DrmVtSwitcher::OnSubscribed,
                     weak_factory_.GetWeakPtr()));
}

void DrmVtSwitcher::ReadSeat() {
  dbus::MethodCall get(kPropertiesInterface, kPropertiesGet);
  dbus::MessageWriter writer(&get);
  writer.AppendString(kSessionInterface);
  writer.AppendString(kSeat);
  session_->CallMethod(
      &get, dbus::ObjectProxy::TIMEOUT_USE_DEFAULT,
      base::BindOnce(&DrmVtSwitcher::OnSeatFound, weak_factory_.GetWeakPtr()));
}

void DrmVtSwitcher::OnSeatFound(dbus::Response* response) {
  if (!response) {
    LOG(FATAL) << "logind would not say which seat this session is on, so "
                  "Ctrl+Alt+F<n> would have no object to ask for a console "
                  "switch and this desktop would have no way out of itself.";
  }

  dbus::MessageReader reader(response);
  const std::optional<dbus::ObjectPath> seat = SeatOfSession(&reader);
  if (!seat.has_value()) {
    LOG(FATAL) << "logind puts this session on no seat, so there is no console "
                  "to switch to. Start Domicile from a logind session on a tty "
                  "of its own, which is a session with a seat.";
  }

  seat_ = bus_->GetObjectProxy(kLogind, *seat);
  VLOG(1) << "Ctrl+Alt+F<n> asks " << seat->value() << " to switch";

  if (pending_console_.has_value()) {
    SwitchTo(*pending_console_);
    pending_console_.reset();
  }
}

void DrmVtSwitcher::SwitchTo(uint32_t console) {
  dbus::MethodCall switch_to(kSeatInterface, kSwitchTo);
  dbus::MessageWriter writer(&switch_to);
  writer.AppendUint32(console);
  seat_->CallMethod(
      &switch_to, dbus::ObjectProxy::TIMEOUT_USE_DEFAULT,
      base::BindOnce(
          [](uint32_t console, dbus::Response* response) {
            if (!response) {
              LOG(ERROR) << "logind would not switch to console " << console;
            }
          },
          console));
}

void DrmVtSwitcher::OnSubscribed(const std::string& interface,
                                 const std::string& signal,
                                 bool connected) {
  if (!connected) {
    LOG(FATAL) << "cannot follow " << interface << "." << signal
               << " on this session, so a console switch would leave Domicile "
                  "holding DRM master over somebody else's console";
  }
  // ONCE, HERE, because a desktop started on a console that is not the one in
  // front of the user is already in the background and would otherwise not
  // hear about it until the next switch.
  ReadActive();
  VLOG(1) << "the console follows logind; Ctrl+Alt+F<n> asks it to switch";
}

void DrmVtSwitcher::OnPropertiesChanged(dbus::Signal*) {
  // The message is not read. logind names a changed property in the
  // dictionary or in the invalidated list depending on the property, and
  // asking for the one value this cares about is cheaper than being right
  // about which -- the table below ignores an answer that changes nothing, so
  // the properties this does not care about cost one round trip and no
  // decision.
  ReadActive();
}

void DrmVtSwitcher::ReadActive() {
  dbus::MethodCall get(kPropertiesInterface, kPropertiesGet);
  dbus::MessageWriter writer(&get);
  writer.AppendString(kSessionInterface);
  writer.AppendString(kActive);
  session_->CallMethod(
      &get, dbus::ObjectProxy::TIMEOUT_USE_DEFAULT,
      base::BindOnce(&DrmVtSwitcher::OnActive, weak_factory_.GetWeakPtr()));
}

void DrmVtSwitcher::OnActive(dbus::Response* response) {
  if (!response) {
    LOG(ERROR) << "logind would not say whether this session is active; the "
                  "display stays where the last answer left it";
    return;
  }

  dbus::MessageReader reader(response);
  bool active = false;
  if (!reader.PopVariantOfBool(&active)) {
    LOG(FATAL) << "logind answered " << kActive << " with something that is "
                                                   "not a boolean";
  }

  Handle(active ? VtEvent::kSessionActivated : VtEvent::kSessionDeactivated,
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
              if (!ok) {
                LOG(ERROR) << "could not drop DRM master for a console switch; "
                              "the console logind handed over is one nothing "
                              "can paint until this session comes back";
              }
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
    case VtAction::kRelightDisplay:
      // AFTER THE TAKE ANSWERED AND NOT BEFORE IT. `TakeDisplayControl` is
      // what puts master back in this process and `has_master()` back in the
      // GPU's, and a modeset asked for ahead of either is the `EACCES` this
      // whole path exists to stop committing.
      modeset_->Relight();
      return;
  }
}

}  // namespace ui
