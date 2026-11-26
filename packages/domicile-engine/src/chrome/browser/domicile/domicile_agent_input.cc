// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_agent_input.h"

#include <algorithm>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <variant>
#include <vector>

#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/logging.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/notreached.h"
#include "base/task/bind_post_task.h"
#include "base/time/time.h"
#include "chrome/browser/domicile/domicile_browser_windows.h"
#include "chrome/browser/domicile/domicile_desk_pointer.h"
#include "components/domicile/browser/agent_input_lines.h"
#include "components/domicile/browser/control_channel.h"
#include "components/domicile/browser/web_view_guest.h"
#include "components/input/native_web_keyboard_event.h"
#include "content/public/browser/browser_task_traits.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/domicile_agent_input.h"
#include "content/public/browser/render_process_host.h"
#include "content/public/browser/render_widget_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/drop_data.h"
#include "third_party/blink/public/common/input/web_input_event.h"
#include "third_party/blink/public/common/input/web_mouse_event.h"
#include "third_party/blink/public/common/input/web_mouse_wheel_event.h"
#include "ui/aura/env.h"
#include "ui/events/blink/blink_event_util.h"
#include "ui/events/event.h"
#include "ui/events/event_observer.h"
#include "ui/events/event_utils.h"
#include "ui/events/keycodes/dom/dom_code.h"
#include "ui/events/keycodes/dom/dom_key.h"
#include "ui/events/keycodes/dom/keycode_converter.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/events/ozone/layout/keyboard_layout_engine.h"
#include "ui/events/ozone/layout/keyboard_layout_engine_manager.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/rect.h"

namespace domicile {
namespace {

// The answers that refuse an event, which the agent reads.
constexpr char kTheShell[] =
    "the shell is at that point: act on the shell by ref (browser_snapshot "
    "with window \"shell\", then browser_click or browser_type)";
constexpr char kNothing[] = "nothing is at that point";
constexpr char kNowhere[] =
    "the agent's pointer has not moved yet: point somewhere first";
constexpr char kTheUsers[] =
    "the user is using this window, so the agent's own pointer and keys can't "
    "reach it now. Act on it by ref (browser_snapshot), or try again once the "
    "user has moved on";
constexpr char kNoKeyboard[] =
    "the agent's keyboard is in no window: click in one, or focus_window, "
    "first";

std::string Barred(const std::string& window) {
  return "the user took over window " + window +
         ", or another agent holds it: act on it by ref, or wait until it is "
         "given back";
}

// The evdev buttons, from linux/input-event-codes.h.
constexpr uint32_t kBtnLeft = 0x110;
constexpr uint32_t kBtnRight = 0x111;
constexpr uint32_t kBtnMiddle = 0x112;
constexpr uint32_t kBtnSide = 0x113;
constexpr uint32_t kBtnExtra = 0x114;

// How close in time and place two presses are to count as one more click,
// as a person's double click.
constexpr base::TimeDelta kClickInterval = base::Milliseconds(500);
constexpr float kClickSlop = 4;

// How long after a press a drag its page starts is still the agent's. The
// page asks to drag after the move that starts it, and the agent's release
// can be dispatched before that ask arrives.
constexpr base::TimeDelta kDragAfterPress = base::Seconds(2);

blink::WebPointerProperties::Button ButtonOf(uint32_t code) {
  switch (code) {
    case kBtnLeft:
      return blink::WebPointerProperties::Button::kLeft;
    case kBtnRight:
      return blink::WebPointerProperties::Button::kRight;
    case kBtnMiddle:
      return blink::WebPointerProperties::Button::kMiddle;
    case kBtnSide:
      return blink::WebPointerProperties::Button::kBack;
    case kBtnExtra:
      return blink::WebPointerProperties::Button::kForward;
    default:
      return blink::WebPointerProperties::Button::kNoButton;
  }
}

int ButtonModifier(uint32_t code) {
  switch (code) {
    case kBtnLeft:
      return blink::WebInputEvent::kLeftButtonDown;
    case kBtnRight:
      return blink::WebInputEvent::kRightButtonDown;
    case kBtnMiddle:
      return blink::WebInputEvent::kMiddleButtonDown;
    case kBtnSide:
      return blink::WebInputEvent::kBackButtonDown;
    case kBtnExtra:
      return blink::WebInputEvent::kForwardButtonDown;
    default:
      return 0;
  }
}

// A widget, found again by its ids: it may go with its page at any time.
struct WidgetRef {
  int process = 0;
  int routing = 0;

  static WidgetRef Of(content::RenderWidgetHost* widget) {
    return {widget->GetProcess()->GetDeprecatedID(), widget->GetRoutingID()};
  }
  content::RenderWidgetHost* Get() const {
    return content::RenderWidgetHost::FromID(process, routing);
  }
  bool operator==(const WidgetRef&) const = default;
};

// The page of the window `widget` is in that the shell holds: the shell's
// inner page holding it. Null for the shell's own widget.
content::WebContents* WindowPageOf(content::RenderWidgetHost* widget,
                                   content::WebContents* shell) {
  content::WebContents* page = content::DomicilePageOfWidget(widget);
  while (page != nullptr && page->GetOuterWebContents() != nullptr &&
         page->GetOuterWebContents() != shell) {
    page = page->GetOuterWebContents();
  }
  return page == shell ? nullptr : page;
}

gfx::PointF OnScreen(content::RenderWidgetHost* widget,
                     const gfx::PointF& in_widget) {
  content::RenderWidgetHostView* view = widget->GetView();
  return view ? in_widget + view->GetViewBounds().OffsetFromOrigin()
              : in_widget;
}

// One agent seat's hold on the pages.
struct Seat {
  // Where its pointer is on the desk, in the shell page's CSS pixels.
  std::optional<gfx::PointF> at;
  // The widget its pointer is over, and that widget's window.
  std::optional<WidgetRef> over;
  std::string pointing;
  // The buttons it holds, and the widget the first went down in, which keeps
  // its pointer until the last comes up.
  std::set<uint32_t> buttons;
  std::optional<WidgetRef> pressed;
  // Its last press, for counting clicks; and when, for a late drag.
  uint32_t last_button = 0;
  gfx::PointF last_press_at;
  base::TimeTicks last_press;
  int clicks = 0;
  std::optional<WidgetRef> last_pressed;
  // The page its keyboard is in, that page's window, and the keys it holds.
  base::WeakPtr<content::WebContents> typing;
  std::string typing_window;
  std::set<uint32_t> keys;
  // A drag a page it pressed in started: what is dragged, from where, and
  // the widget under its pointer that hears it.
  struct Drag {
    content::DropData data;
    blink::DragOperationsMask allowed = blink::kDragOperationNone;
    WidgetRef source;
    std::optional<WidgetRef> over;
    ui::mojom::DragOperation operation = ui::mojom::DragOperation::kNone;
  };
  std::optional<Drag> drag;
};

// What a desk point lands on, for one seat's event.
struct Landed {
  raw_ptr<content::RenderWidgetHost> widget = nullptr;
  gfx::PointF in_widget;
  raw_ptr<content::WebContents> page = nullptr;
  std::string window;
};

// Notes who last pressed or keyed in browser window `window`'s page, an agent
// or a person: a file request the page makes next goes to the agent only if
// an agent did. See WebViewGuest::NoteAgentInput.
void NoteInputIn(const std::string& window, bool agent) {
  content::WebContents* page = BrowserWindowContents(window);
  WebViewGuest* guest =
      page == nullptr ? nullptr : WebViewGuest::FromWebContents(page);
  if (guest == nullptr) {
    return;
  }
  if (agent) {
    guest->NoteAgentInput();
  } else {
    guest->NotePersonInput();
  }
}

class AgentSeatsInPages : public ui::EventObserver {
 public:
  AgentSeatsInPages() {
    aura::Env* env = aura::Env::GetInstance();
    env->AddEventObserver(
        this, env,
        {ui::EventType::kMouseMoved, ui::EventType::kMouseDragged,
         ui::EventType::kMousePressed, ui::EventType::kKeyPressed});
  }

  static AgentSeatsInPages& Get() {
    static base::NoDestructor<AgentSeatsInPages> seats;
    return *seats;
  }

  void Take(AgentPageInput input, AgentInputTell tell) {
    DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
    // Every page's channel hears each event; the first counts.
    if (last_serial_ && input.serial <= *last_serial_) {
      return;
    }
    last_serial_ = input.serial;
    tell_ = tell;
    Reached reached = Run(input);
    VLOG(1) << "domicile: agent seat " << input.seat << "'s event "
            << input.serial << " reached "
            << (reached.window ? *reached.window : "nothing")
            << (reached.refused ? " (refused: " + *reached.refused + ")"
                                : std::string());
    if (!input.quiet) {
      tell.Run(AgentInputReachedMessage(input.serial, reached.window,
                                        reached.refused));
    }
  }

  // content's drag taker: a drag in a widget an agent pressed in is the
  // agent's.
  bool TakeDrag(content::RenderWidgetHost* source,
                const content::DropData& data,
                blink::DragOperationsMask allowed) {
    const WidgetRef ref = WidgetRef::Of(source);
    for (auto& [id, seat] : seats_) {
      const bool held = seat.pressed == ref;
      const bool late = seat.last_pressed == ref &&
                        base::TimeTicks::Now() - seat.last_press <
                            kDragAfterPress;
      if (!held && !late) {
        continue;
      }
      LOG(INFO) << "domicile: agent seat " << id
                << " drags from its page; the platform's drag is not started";
      if (!held) {
        // Released already: the drag ends where it began.
        source->DragSourceSystemDragEnded();
        return true;
      }
      seat.drag = Seat::Drag{.data = data, .allowed = allowed, .source = ref};
      // Its page hears no more mouse events until the drag ends.
      seat.over.reset();
      DragOver(seat, Modifiers(seat));
      return true;
    }
    return false;
  }

 private:
  struct Reached {
    std::optional<std::string> window;
    std::optional<std::string> refused;
  };

  static Reached Refused(std::string why) { return {std::nullopt, why}; }
  static Reached Window(std::string window) { return {window, std::nullopt}; }

  Reached Run(const AgentPageInput& input) {
    using Kind = AgentPageInput::Kind;
    Seat& seat = seats_[input.seat];
    switch (input.kind) {
      case Kind::kPointer:
        return Move(input, seat);
      case Kind::kButton:
        return Button(input, seat);
      case Kind::kScroll:
        return Scroll(input, seat);
      case Kind::kKey:
        return Key(input, seat);
      case Kind::kFocus:
        return Focus(input, seat);
      case Kind::kLeave:
        Leave(seat);
        return {};
      case Kind::kBlur:
        Blur(seat);
        return {};
      case Kind::kLetGo:
        LetGo(seat);
        return {};
      case Kind::kGone:
        LetGo(seat);
        Leave(seat);
        Blur(seat);
        seats_.erase(input.seat);
        return {};
    }
    NOTREACHED();
  }

  // What `at` lands on, for an event that must not reach `barred` windows.
  // Refused: the shell, nothing, a window the user is in, a barred one.
  std::variant<Landed, std::string> Land(const gfx::PointF& at,
                                         const std::vector<std::string>& barred,
                                         bool keyboard_only = false) {
    content::WebContents* shell = DeskShellContents();
    if (shell == nullptr) {
      return std::string(kNothing);
    }
    std::optional<content::DomicileWidgetAt> found =
        content::DomicileWidgetAtPoint(shell, at);
    if (!found) {
      return std::string(kNothing);
    }
    Landed landed{.widget = found->widget, .in_widget = found->in_widget};
    landed.page = WindowPageOf(found->widget, shell);
    landed.window = landed.page ? BrowserWindowOfPage(landed.page) : "";
    if (landed.window.empty()) {
      return std::string(kTheShell);
    }
    if (std::optional<std::string> why =
            Barring(landed.window, barred, keyboard_only)) {
      return *why;
    }
    return landed;
  }

  // Why an agent's event can't reach `window`, if it can't.
  std::optional<std::string> Barring(const std::string& window,
                                     const std::vector<std::string>& barred,
                                     bool keyboard_only) {
    if (std::ranges::find(barred, window) != barred.end()) {
      return Barred(window);
    }
    content::WebContents* shell = DeskShellContents();
    content::WebContents* users = content::DomicileUsersFocusedPage(shell);
    if (users != nullptr && users != shell &&
        BrowserWindowOfPage(users) == window) {
      return std::string(kTheUsers);
    }
    if (!keyboard_only && UsersPointerWindow() == window) {
      return std::string(kTheUsers);
    }
    return std::nullopt;
  }

  // The browser window under the user's pointer, if any.
  std::string UsersPointerWindow() {
    content::WebContents* shell = DeskShellContents();
    if (shell == nullptr || !users_pointer_) {
      return std::string();
    }
    std::optional<content::DomicileWidgetAt> found =
        content::DomicileWidgetAtPoint(shell, *users_pointer_);
    content::WebContents* page =
        found ? WindowPageOf(found->widget, shell) : nullptr;
    return page ? BrowserWindowOfPage(page) : std::string();
  }

  // The modifiers the seat holds, as ui::EventFlags.
  int Flags(const Seat& seat) {
    int flags = 0;
    ui::KeyboardLayoutEngine* layout =
        ui::KeyboardLayoutEngineManager::GetKeyboardLayoutEngine();
    for (uint32_t key : seat.keys) {
      ui::DomKey dom_key;
      ui::KeyboardCode key_code;
      if (!layout->Lookup(ui::KeycodeConverter::EvdevCodeToDomCode(key), 0,
                          &dom_key, &key_code)) {
        continue;
      }
      if (dom_key == ui::DomKey::SHIFT) {
        flags |= ui::EF_SHIFT_DOWN;
      } else if (dom_key == ui::DomKey::CONTROL) {
        flags |= ui::EF_CONTROL_DOWN;
      } else if (dom_key == ui::DomKey::ALT) {
        flags |= ui::EF_ALT_DOWN;
      } else if (dom_key == ui::DomKey::META || dom_key == ui::DomKey::SUPER) {
        flags |= ui::EF_COMMAND_DOWN;
      } else if (dom_key == ui::DomKey::ALT_GRAPH) {
        flags |= ui::EF_ALTGR_DOWN;
      }
    }
    return flags;
  }

  // The seat's modifiers and held buttons, as blink's.
  int Modifiers(const Seat& seat) {
    int modifiers = ui::EventFlagsToWebEventModifiers(Flags(seat));
    for (uint32_t button : seat.buttons) {
      modifiers |= ButtonModifier(button);
    }
    return modifiers;
  }

  void SendMouse(content::RenderWidgetHost* widget,
                 blink::WebInputEvent::Type type,
                 const gfx::PointF& in_widget,
                 blink::WebPointerProperties::Button button,
                 int clicks,
                 int modifiers) {
    blink::WebMouseEvent event(type, modifiers, ui::EventTimeForNow());
    event.button = button;
    event.click_count = clicks;
    event.pointer_type = blink::WebPointerProperties::PointerType::kMouse;
    event.SetPositionInWidget(in_widget);
    event.SetPositionInScreen(OnScreen(widget, in_widget));
    content::DomicileForwardKeepingFocus(
        widget, base::BindOnce(
                    [](content::RenderWidgetHost* widget,
                       const blink::WebMouseEvent& event) {
                      widget->ForwardMouseEvent(event);
                    },
                    base::Unretained(widget), event));
  }

  // The widget that takes the seat's pointer at `at`: the one pressed in,
  // while a button is down.
  struct Target {
    raw_ptr<content::RenderWidgetHost> widget = nullptr;
    gfx::PointF in_widget;
    std::string window;
  };
  std::optional<Target> Captured(const Seat& seat, const gfx::PointF& at) {
    content::RenderWidgetHost* widget =
        seat.pressed ? seat.pressed->Get() : nullptr;
    content::WebContents* shell = DeskShellContents();
    if (widget == nullptr || shell == nullptr) {
      return std::nullopt;
    }
    std::optional<gfx::PointF> in_widget =
        content::DomicilePointInWidget(shell, widget, at);
    content::WebContents* page = WindowPageOf(widget, shell);
    if (!in_widget || page == nullptr) {
      return std::nullopt;
    }
    return Target{widget, *in_widget, BrowserWindowOfPage(page)};
  }

  // The pointer leaves the widget it was over.
  void LeaveWidget(Seat& seat) {
    if (!seat.over) {
      return;
    }
    if (content::RenderWidgetHost* widget = seat.over->Get()) {
      SendMouse(widget, blink::WebInputEvent::Type::kMouseLeave, gfx::PointF(),
                blink::WebPointerProperties::Button::kNoButton, 0,
                Modifiers(seat));
    }
    seat.over.reset();
  }

  Reached Move(const AgentPageInput& input, Seat& seat) {
    seat.at = input.at;
    if (seat.drag) {
      return DragOver(seat, Modifiers(seat));
    }
    if (std::optional<Target> captured = Captured(seat, input.at)) {
      SendMouse(captured->widget, blink::WebInputEvent::Type::kMouseMove,
                captured->in_widget,
                blink::WebPointerProperties::Button::kNoButton, 0,
                Modifiers(seat));
      seat.pointing = captured->window;
      return Window(captured->window);
    }
    auto landed = Land(input.at, input.barred);
    if (auto* why = std::get_if<std::string>(&landed)) {
      LeaveWidget(seat);
      seat.pointing.clear();
      return Refused(*why);
    }
    Landed& on = std::get<Landed>(landed);
    const WidgetRef ref = WidgetRef::Of(on.widget);
    if (seat.over && *seat.over != ref) {
      LeaveWidget(seat);
    }
    seat.over = ref;
    seat.pointing = on.window;
    SendMouse(on.widget, blink::WebInputEvent::Type::kMouseMove, on.in_widget,
              blink::WebPointerProperties::Button::kNoButton, 0,
              Modifiers(seat));
    return Window(on.window);
  }

  Reached Button(const AgentPageInput& input, Seat& seat) {
    const blink::WebPointerProperties::Button button = ButtonOf(input.code);
    if (!input.pressed) {
      if (!seat.buttons.erase(input.code)) {
        return {};
      }
      if (seat.drag) {
        if (seat.buttons.empty()) {
          return Drop(seat);
        }
        return {};
      }
      std::optional<Target> captured =
          seat.at ? Captured(seat, *seat.at) : std::nullopt;
      if (captured) {
        // A release's modifiers still hold the button that came up.
        SendMouse(captured->widget, blink::WebInputEvent::Type::kMouseUp,
                  captured->in_widget, button, seat.clicks,
                  Modifiers(seat) | ButtonModifier(input.code));
      }
      if (seat.buttons.empty()) {
        seat.pressed.reset();
      }
      return captured ? Window(captured->window) : Reached();
    }
    if (!seat.at) {
      return Refused(kNowhere);
    }
    content::RenderWidgetHost* widget = nullptr;
    gfx::PointF in_widget;
    std::string window;
    content::WebContents* page = nullptr;
    if (std::optional<Target> captured = Captured(seat, *seat.at)) {
      widget = captured->widget;
      in_widget = captured->in_widget;
      window = captured->window;
    } else {
      auto landed = Land(*seat.at, input.barred);
      if (auto* why = std::get_if<std::string>(&landed)) {
        return Refused(*why);
      }
      Landed& on = std::get<Landed>(landed);
      widget = on.widget;
      in_widget = on.in_widget;
      window = on.window;
      page = on.page;
      seat.pressed = WidgetRef::Of(widget);
    }
    const base::TimeTicks now = base::TimeTicks::Now();
    const bool again = input.code == seat.last_button &&
                       now - seat.last_press < kClickInterval &&
                       (*seat.at - seat.last_press_at).Length() <= kClickSlop;
    seat.clicks = again ? std::min(seat.clicks + 1, 3) : 1;
    seat.last_button = input.code;
    seat.last_press = now;
    seat.last_press_at = *seat.at;
    seat.last_pressed = WidgetRef::Of(widget);
    seat.buttons.insert(input.code);
    // A press gives its page the agent's keyboard, as a hand's does, beside
    // the user's.
    if (page != nullptr) {
      TypeIn(seat, page, window);
    }
    NoteInputIn(window, /*agent=*/true);
    SendMouse(widget, blink::WebInputEvent::Type::kMouseDown, in_widget,
              button, seat.clicks, Modifiers(seat));
    return Window(window);
  }

  Reached Scroll(const AgentPageInput& input, Seat& seat) {
    if (!seat.at) {
      return Refused(kNowhere);
    }
    auto landed = Land(*seat.at, input.barred);
    if (auto* why = std::get_if<std::string>(&landed)) {
      return Refused(*why);
    }
    Landed& on = std::get<Landed>(landed);
    blink::WebMouseWheelEvent wheel(blink::WebInputEvent::Type::kMouseWheel,
                                    Modifiers(seat), ui::EventTimeForNow());
    wheel.SetPositionInWidget(on.in_widget);
    wheel.SetPositionInScreen(OnScreen(on.widget, on.in_widget));
    // Down and right are positive on the desk; a wheel's deltas move the
    // page's content, so they are the other way.
    wheel.delta_x = -input.scroll.x();
    wheel.delta_y = -input.scroll.y();
    wheel.delta_units = ui::ScrollGranularity::kScrollByPrecisePixel;
    wheel.phase = blink::WebMouseWheelEvent::kPhaseBegan;
    wheel.dispatch_type = blink::WebInputEvent::DispatchType::kBlocking;
    content::RenderWidgetHost* widget = on.widget;
    content::DomicileForwardKeepingFocus(
        widget, base::BindOnce(
                    [](content::RenderWidgetHost* widget,
                       blink::WebMouseWheelEvent wheel) {
                      widget->ForwardWheelEvent(wheel);
                      // The scroll ends with it, as a wheel's tick does.
                      wheel.delta_x = 0;
                      wheel.delta_y = 0;
                      wheel.phase = blink::WebMouseWheelEvent::kPhaseEnded;
                      wheel.dispatch_type =
                          blink::WebInputEvent::DispatchType::kEventNonBlocking;
                      widget->ForwardWheelEvent(wheel);
                    },
                    base::Unretained(widget), wheel));
    return Window(on.window);
  }

  Reached Key(const AgentPageInput& input, Seat& seat) {
    content::WebContents* page = seat.typing.get();
    if (input.pressed && page == nullptr) {
      return Refused(kNoKeyboard);
    }
    if (input.pressed) {
      if (std::optional<std::string> why =
              Barring(seat.typing_window, input.barred,
                      /*keyboard_only=*/true)) {
        return Refused(*why);
      }
      seat.keys.insert(input.code);
    } else if (!seat.keys.erase(input.code)) {
      return {};
    }
    if (page == nullptr) {
      return {};
    }
    if (input.pressed) {
      NoteInputIn(seat.typing_window, /*agent=*/true);
    }
    SendKey(page, input.code, input.pressed, Flags(seat));
    return Window(seat.typing_window);
  }

  // Evdev key `code` into `page`'s focused frame, pressed or released with
  // modifiers `flags`: a key down and the character it types, as the desk's
  // keyboard sends, or a key up.
  void SendKey(content::WebContents* page,
               uint32_t code,
               bool pressed,
               int flags) {
    const ui::DomCode dom_code = ui::KeycodeConverter::EvdevCodeToDomCode(code);
    ui::DomKey dom_key;
    ui::KeyboardCode key_code;
    if (!ui::KeyboardLayoutEngineManager::GetKeyboardLayoutEngine()->Lookup(
            dom_code, flags, &dom_key, &key_code)) {
      LOG(WARNING) << "domicile: an agent pressed evdev key " << code
                   << ", which the desk's keyboard has nothing for";
      return;
    }
    const ui::KeyEvent key(
        pressed ? ui::EventType::kKeyPressed : ui::EventType::kKeyReleased,
        key_code, dom_code, flags, dom_key, ui::EventTimeForNow());
    content::RenderWidgetHost* widget = content::DomicileKeyWidgetOf(page);
    widget->ForwardKeyboardEvent(Agents(input::NativeWebKeyboardEvent(key)));
    if (!pressed) {
      return;
    }
    // The character it types, unless a shortcut's modifier holds it, as the
    // desk's input method decides.
    const bool shortcut =
        (flags & (ui::EF_CONTROL_DOWN | ui::EF_ALT_DOWN |
                  ui::EF_COMMAND_DOWN)) != 0 &&
        (flags & ui::EF_ALTGR_DOWN) == 0;
    const char16_t character = key.GetCharacter();
    if (shortcut || character == 0 ||
        !(dom_key.IsCharacter() || key_code == ui::VKEY_RETURN)) {
      return;
    }
    widget->ForwardKeyboardEvent(
        Agents(input::NativeWebKeyboardEvent(key, character)));
  }

  // `event`, marked as no user's: the page alone handles it, as DevTools keys
  // with no native key code are. The browser skips PreHandleKeyboardEvent and
  // HandleKeyboardEvent for it, so the shell never hears it as the user's key
  // in that window (`domicile-key-delivered`, which raises and focuses it),
  // and it runs no desk, browser or extension shortcut.
  static input::NativeWebKeyboardEvent Agents(
      input::NativeWebKeyboardEvent event) {
    event.skip_if_unhandled = true;
    return event;
  }

  Reached Focus(const AgentPageInput& input, Seat& seat) {
    content::WebContents* page = BrowserWindowContents(input.window);
    if (page == nullptr) {
      return Refused("no browser window is " + input.window);
    }
    if (std::optional<std::string> why =
            Barring(input.window, input.barred, /*keyboard_only=*/true)) {
      return Refused(*why);
    }
    TypeIn(seat, page, input.window);
    return Window(input.window);
  }

  // The seat's keyboard goes to `page`, of `window`.
  void TypeIn(Seat& seat, content::WebContents* page, std::string window) {
    if (seat.typing.get() != page) {
      ReleaseKeys(seat);
      if (content::WebContents* was = seat.typing.get()) {
        content::DomicileSetAgentPageFocus(was, false);
      }
    }
    content::DomicileSetAgentPageFocus(page, true);
    seat.typing = page->GetWeakPtr();
    seat.typing_window = std::move(window);
  }

  void Leave(Seat& seat) {
    LeaveWidget(seat);
    seat.pointing.clear();
  }

  void Blur(Seat& seat) {
    ReleaseKeys(seat);
    if (content::WebContents* page = seat.typing.get()) {
      content::DomicileSetAgentPageFocus(page, false);
    }
    seat.typing.reset();
    seat.typing_window.clear();
  }

  void ReleaseKeys(Seat& seat) {
    content::WebContents* page = seat.typing.get();
    std::set<uint32_t> keys = std::exchange(seat.keys, {});
    if (page == nullptr) {
      return;
    }
    for (uint32_t key : keys) {
      SendKey(page, key, false, Flags(seat));
    }
  }

  void LetGo(Seat& seat) {
    ReleaseKeys(seat);
    if (seat.drag) {
      EndDrag(seat, /*dropped=*/false);
    }
    std::optional<Target> captured =
        seat.at ? Captured(seat, *seat.at) : std::nullopt;
    for (uint32_t button : std::exchange(seat.buttons, {})) {
      if (captured) {
        SendMouse(captured->widget, blink::WebInputEvent::Type::kMouseUp,
                  captured->in_widget, ButtonOf(button), seat.clicks,
                  Modifiers(seat));
      }
    }
    seat.pressed.reset();
  }

  // The seat's drag goes over what is under its pointer.
  Reached DragOver(Seat& seat, int modifiers) {
    Seat::Drag& drag = *seat.drag;
    content::WebContents* shell = DeskShellContents();
    std::optional<content::DomicileWidgetAt> found =
        shell && seat.at ? content::DomicileWidgetAtPoint(shell, *seat.at)
                         : std::nullopt;
    content::WebContents* page =
        found ? WindowPageOf(found->widget, shell) : nullptr;
    const std::string window = page ? BrowserWindowOfPage(page) : "";
    content::RenderWidgetHost* under =
        window.empty() ? nullptr : found->widget.get();
    content::RenderWidgetHost* was = drag.over ? drag.over->Get() : nullptr;
    if (was != nullptr && was != under) {
      was->DragTargetDragLeave(gfx::PointF(), gfx::PointF());
      drag.over.reset();
      drag.operation = ui::mojom::DragOperation::kNone;
    }
    if (under == nullptr) {
      seat.pointing.clear();
      return window.empty() ? Refused(kTheShell) : Reached();
    }
    const gfx::PointF screen = OnScreen(under, found->in_widget);
    auto heard = base::BindOnce(
        [](base::WeakPtr<AgentSeatsInPages> self, std::string seat_id,
           WidgetRef over, ui::mojom::DragOperation operation, bool) {
          if (!self) {
            return;
          }
          auto seat = self->seats_.find(seat_id);
          if (seat != self->seats_.end() && seat->second.drag &&
              seat->second.drag->over == over) {
            seat->second.drag->operation = operation;
          }
        },
        weak_factory_.GetWeakPtr(), SeatIdOf(seat), WidgetRef::Of(under));
    if (was == under) {
      under->DragTargetDragOver(found->in_widget, screen, drag.allowed,
                                modifiers, std::move(heard));
    } else {
      content::DropData data = drag.data;
      under->FilterDropData(&data);
      under->DragTargetDragEnter(data, found->in_widget, screen, drag.allowed,
                                 modifiers, std::move(heard));
      drag.over = WidgetRef::Of(under);
    }
    seat.pointing = window;
    return Window(window);
  }

  // The seat's last button came up during its drag: it drops where the page
  // under it accepted, and ends.
  Reached Drop(Seat& seat) {
    const std::string window = seat.pointing;
    EndDrag(seat, /*dropped=*/true);
    seat.pressed.reset();
    return window.empty() ? Reached() : Window(window);
  }

  void EndDrag(Seat& seat, bool dropped) {
    Seat::Drag drag = std::move(*seat.drag);
    seat.drag.reset();
    content::RenderWidgetHost* over = drag.over ? drag.over->Get() : nullptr;
    content::RenderWidgetHost* source = drag.source.Get();
    content::WebContents* shell = DeskShellContents();
    const gfx::PointF at = seat.at.value_or(gfx::PointF());
    ui::mojom::DragOperation operation = drag.operation;
    if (over != nullptr && dropped &&
        operation != ui::mojom::DragOperation::kNone) {
      std::optional<gfx::PointF> in_over =
          shell ? content::DomicilePointInWidget(shell, over, at)
                : std::nullopt;
      const gfx::PointF point = in_over.value_or(gfx::PointF());
      content::DropData data = drag.data;
      over->FilterDropData(&data);
      data.operation = operation;
      over->DragTargetDrop(data, point, OnScreen(over, point),
                           Modifiers(seat), base::DoNothing());
    } else {
      if (over != nullptr) {
        over->DragTargetDragLeave(gfx::PointF(), gfx::PointF());
      }
      operation = ui::mojom::DragOperation::kNone;
    }
    if (source != nullptr) {
      std::optional<gfx::PointF> in_source =
          shell ? content::DomicilePointInWidget(shell, source, at)
                : std::nullopt;
      source->DragSourceEndedAt(
          in_source, in_source ? std::optional(OnScreen(source, *in_source))
                               : std::nullopt,
          operation, base::DoNothing());
      source->DragSourceSystemDragEnded();
    }
  }

  std::string SeatIdOf(const Seat& seat) const {
    for (const auto& [id, held] : seats_) {
      if (&held == &seat) {
        return id;
      }
    }
    NOTREACHED() << "a seat is one of the seats";
  }

  // ui::EventObserver: the user's own input, which the platform dispatched.
  // An agent's never passes through aura.
  void OnEvent(const ui::Event& event) override {
    if (event.IsLocatedEvent()) {
      users_pointer_ = ShellPointOf(*event.AsLocatedEvent());
    }
    const bool pressed = event.type() == ui::EventType::kMousePressed;
    // The user's own press or key takes the window's file requests back from
    // any agent, whether or not an agent seat is here now.
    if (pressed) {
      NoteInputIn(UsersPointerWindow(), /*agent=*/false);
    } else if (event.type() == ui::EventType::kKeyPressed) {
      content::WebContents* shell = DeskShellContents();
      content::WebContents* users = content::DomicileUsersFocusedPage(shell);
      if (users != nullptr && users != shell) {
        NoteInputIn(BrowserWindowOfPage(users), /*agent=*/false);
      }
    }
    if (seats_.empty() || !tell_) {
      return;
    }
    if (event.IsMouseEvent()) {
      const std::string window = UsersPointerWindow();
      if (window.empty()) {
        return;
      }
      for (auto& [id, seat] : seats_) {
        const bool pointing = seat.pointing == window;
        const bool typing = pressed && seat.typing_window == window;
        if (pointing || typing) {
          PersonIn(id, seat, window, typing);
        }
      }
      return;
    }
    content::WebContents* shell = DeskShellContents();
    content::WebContents* users = content::DomicileUsersFocusedPage(shell);
    const std::string window =
        users && users != shell ? BrowserWindowOfPage(users) : "";
    if (window.empty()) {
      return;
    }
    for (auto& [id, seat] : seats_) {
      if (seat.typing_window == window) {
        PersonIn(id, seat, window, /*keyboard=*/true);
      }
    }
  }

  // The user's input reached `window`, which seat `id` holds: it lets go
  // there now, and the compositor hears, which takes the window from it.
  void PersonIn(const std::string& id,
                Seat& seat,
                const std::string& window,
                bool keyboard) {
    LOG(INFO) << "domicile: the user's "
              << (keyboard ? "keyboard" : "pointer") << " reached window "
              << window << ", which agent seat " << id << " holds";
    LetGo(seat);
    if (seat.pointing == window) {
      Leave(seat);
    }
    if (keyboard && seat.typing_window == window) {
      Blur(seat);
    }
    tell_.Run(PersonInAgentsWindowMessage(id, window, keyboard));
  }

  std::map<std::string, Seat> seats_;
  std::optional<uint64_t> last_serial_;
  // Sends on the channel that last carried an agent's input.
  AgentInputTell tell_;
  // Where the user's pointer last was, in the shell page's CSS pixels.
  std::optional<gfx::PointF> users_pointer_;
  base::WeakPtrFactory<AgentSeatsInPages> weak_factory_{this};
};

}  // namespace

void StartAgentInput() {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  // Made here, on the UI thread, before any channel can call the sink.
  AgentSeatsInPages::Get();
  SetAgentInputSink(base::BindPostTask(
      content::GetUIThreadTaskRunner({}),
      base::BindRepeating([](AgentPageInput input, AgentInputTell tell) {
        AgentSeatsInPages::Get().Take(std::move(input), std::move(tell));
      })));
  content::SetDomicileDragTaker(base::BindRepeating(
      [](content::RenderWidgetHost* source, const content::DropData& data,
         blink::DragOperationsMask allowed) {
        return AgentSeatsInPages::Get().TakeDrag(source, data, allowed);
      }));
}

}  // namespace domicile
