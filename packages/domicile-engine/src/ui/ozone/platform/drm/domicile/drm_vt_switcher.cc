// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

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
// Switch through the seat, not the session: `Seat.SwitchTo(u)` takes a VT
// number, while `Session.Activate` needs a known session. logind's polkit
// policy allows `chvt` for active sessions without authentication. The seat
// is read from the session; see `SeatOfSession`.
constexpr char kSeatInterface[] = "org.freedesktop.login1.Seat";

constexpr char kGetSessionByPID[] = "GetSessionByPID";
constexpr char kSwitchTo[] = "SwitchTo";

constexpr char kPropertiesInterface[] = "org.freedesktop.DBus.Properties";
constexpr char kPropertiesGet[] = "Get";
constexpr char kPropertiesChanged[] = "PropertiesChanged";
constexpr char kActive[] = "Active";
constexpr char kSeat[] = "Seat";

// The seat path logind reports for a session on no seat.
constexpr char kNoSeat[] = "/";

// F1 to F12 are contiguous, so the console number is computed from the key.
constexpr int kConsoles = 12;

// The chord must match the whole modifier mask, so `Ctrl+Alt+Shift+F1` stays
// available to other shortcuts.
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
  // A single return: returning from every enum case still triggers a
  // fall-off-the-end warning, which this tree treats as an error.
  VtStep step = {state, VtAction::kNothing};

  switch (event) {
    case VtEvent::kSessionDeactivated:
      switch (state) {
        case VtState::kForeground:
          step = {VtState::kRelinquishing, VtAction::kRelinquishDisplay};
          break;
        case VtState::kTaking:
          // The in-flight take will see `kBackground` and drop the display.
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
          // Background either way. A failed drop leaves the display unusable
          // until the take on the way back.
          step = {VtState::kBackground, VtAction::kNothing};
          break;
        case VtState::kForeground:
          // The session came back during the drop, so take the display back.
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
          // Taking now would race the in-flight drop. When the drop finishes
          // it sees `kForeground` and takes the display.
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
          // Relight as part of coming back: another process has programmed
          // the CRTCs. See `VtAction::kRelightDisplay`.
          step = succeeded
                     ? VtStep{VtState::kForeground, VtAction::kRelightDisplay}
                     : VtStep{VtState::kForegroundWithoutDisplay,
                              VtAction::kNothing};
          break;
        case VtState::kBackground:
          // The session left during the take. A successful take would leave
          // this process holding DRM master on another console, so drop it.
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
  // The bus runs on a thread-pool worker, which installs the
  // `FileDescriptorWatcher` it needs. The origin thread is the UI thread, so
  // signals and replies arrive where the delegate may be called and keys are
  // dispatched. Nothing here blocks.
  //
  // Dedicated, because `DrmLogindInput` makes blocking calls. On a shared
  // thread they would delay the session-inactive signal that starts the drop;
  // without the drop, `PageFlipWatchdog` kills the GPU process after 15
  // seconds. See `domicile/drm_logind_input.cc`.
  options.dbus_task_runner = base::ThreadPool::CreateSingleThreadTaskRunner(
      {base::MayBlock(), base::TaskPriority::USER_BLOCKING},
      base::SingleThreadTaskRunnerThreadMode::DEDICATED);
  bus_ = base::MakeRefCounted<dbus::Bus>(std::move(options));

  dbus::ObjectProxy* manager =
      bus_->GetObjectProxy(kLogind, dbus::ObjectPath(kManagerPath));
  dbus::MethodCall find_session(kManagerInterface, kGetSessionByPID);
  dbus::MessageWriter writer(&find_session);
  // Zero asks logind to use the caller's D-Bus credentials, which avoids
  // needing `XDG_SESSION_ID` or a pid valid across namespaces.
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
  // Blocking is allowed here: this runs during ozone platform shutdown, where
  // `dbus_thread_linux::ShutdownOnDBusThreadAndBlock` closes the browser's
  // buses the same way.
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

  // The seat takes two D-Bus round trips to learn, and this thread dispatches
  // every key, so it cannot wait. Remember the console; `OnSeatFound` switches
  // to it.
  if (seat_ == nullptr) {
    pending_console_ = console;
    return;
  }

  SwitchTo(*console);
}

// Unused; required by the observer interface.
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
  // Read once at startup: a desktop started on a background console would
  // otherwise not learn that until the next switch.
  ReadActive();
  VLOG(1) << "the console follows logind; Ctrl+Alt+F<n> asks it to switch";
}

void DrmVtSwitcher::OnPropertiesChanged(dbus::Signal*) {
  // Re-read `Active` instead of parsing the message: logind may report it in
  // the changed dictionary or the invalidated list. Irrelevant changes cost a
  // round trip and change no state.
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
      // Only after the take succeeds: before it, the GPU process lacks DRM
      // master and the modeset fails with EACCES.
      modeset_->Relight();
      return;
  }
}

}  // namespace ui
