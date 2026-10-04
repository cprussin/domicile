// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_host.h"

#include <cmath>
#include <optional>
#include <string_view>
#include <utility>

#include "base/check.h"
#include "base/functional/callback.h"
#include "ui/events/keycodes/dom/keycode_converter.h"
#include "components/domicile/common/cursor_shape.h"
#include "components/domicile/common/display_transform.h"
#include "components/domicile/common/theme.h"
#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_app_search.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_cursor_shape.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_file_preview.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_file_search.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_shortcut.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_theme.h"
#include "third_party/blink/renderer/core/css/media_query_list.h"
#include "third_party/blink/renderer/core/css/media_query_list_listener.h"
#include "third_party/blink/renderer/core/dom/events/native_event_listener.h"
#include "third_party/blink/renderer/core/events/keyboard_event.h"
#include "third_party/blink/renderer/core/inspector/console_message.h"
#include "third_party/blink/renderer/core/event_target_names.h"
#include "third_party/blink/renderer/core/event_type_names.h"
#include "third_party/blink/renderer/core/frame/local_dom_window.h"
#include "third_party/blink/renderer/core/timing/dom_window_performance.h"
#include "third_party/blink/renderer/core/timing/window_performance.h"
#include "third_party/blink/renderer/modules/domicile/domicile_app_cursor_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_app_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_modifiers_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_app_titled_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_audio_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_audio_levels_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_apps_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_battery_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_bookmark.h"
#include "third_party/blink/renderer/modules/domicile/domicile_clipboard_entry.h"
#include "third_party/blink/renderer/modules/domicile/domicile_clipboard_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_desktop_entry.h"
#include "third_party/blink/renderer/modules/domicile/domicile_display.h"
#include "third_party/blink/renderer/modules/domicile/domicile_extension.h"
#include "third_party/blink/renderer/modules/domicile/domicile_extensions_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_file_preview_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_files_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_idle_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_locked_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_notification.h"
#include "third_party/blink/renderer/modules/domicile/domicile_notification_action.h"
#include "third_party/blink/renderer/modules/domicile/domicile_notifications_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_open_url_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_shell_config_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_shortcut_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_theme_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_tray_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_tray_item.h"
#include "third_party/blink/renderer/modules/domicile/domicile_window.h"
#include "third_party/blink/renderer/platform/bindings/exception_code.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/heap/persistent.h"
#include "third_party/blink/renderer/platform/json/json_parser.h"
#include "third_party/blink/renderer/platform/json/json_values.h"
#include "third_party/blink/renderer/platform/wtf/functional.h"
#include "third_party/blink/renderer/platform/wtf/text/string_builder.h"

namespace blink {

namespace {

// `resize` on the shell's window, which is the desktop changing size.
class DesktopResized final : public NativeEventListener {
 public:
  explicit DesktopResized(base::RepeatingClosure report)
      : report_(std::move(report)) {}

  void Invoke(ExecutionContext*, Event*) override { report_.Run(); }

 private:
  const base::RepeatingClosure report_;
};

// A key went down on the page.
class PageKeyPressed final : public NativeEventListener {
 public:
  explicit PageKeyPressed(base::RepeatingCallback<void(Event*)> pressed)
      : pressed_(std::move(pressed)) {}

  void Invoke(ExecutionContext*, Event* event) override { pressed_.Run(event); }

 private:
  const base::RepeatingCallback<void(Event*)> pressed_;
};

// The ratio the last report named stopped matching: the window moved to a
// display of another density, or the page was zoomed.
class DensityChanged final : public MediaQueryListListener {
 public:
  explicit DensityChanged(base::RepeatingClosure report)
      : report_(std::move(report)) {}

  void NotifyMediaQueryChanged() override { report_.Run(); }

 private:
  const base::RepeatingClosure report_;
};

}  // namespace

DomicileHost::DomicileHost(LocalDOMWindow& window)
    : window_(&window),
      // `displays_` is left null: a shell that has not been told about a
      // desktop must be able to tell that apart from one told there are no
      // screens. See the attribute's note in the IDL.
      //
      // Initialized in declaration order, which is not a style point here:
      // Chromium builds -Wreorder -Werror, so a list out of order is a build
      // failure rather than a warning.
      channel_(&window),
      client_receiver_(this, &window),
      tray_(&window),
      tray_receiver_(this, &window) {}

DomicileHost::~DomicileHost() = default;

bool DomicileHost::EnsureBound() {
  if (channel_.is_bound()) {
    return true;
  }
  if (!window_ || !window_->GetFrame()) {
    return false;
  }
  auto task_runner = window_->GetTaskRunner(TaskType::kInternalDefault);
  window_->GetBrowserInterfaceBroker().GetInterface(
      channel_.BindNewPipeAndPassReceiver(task_runner));
  if (!channel_.is_bound()) {
    return false;
  }

  // Hand back the other direction in the same breath. A channel bound without
  // a client is one the compositor can be heard on by nobody, and every
  // inbound message would be dropped in the browser with no way to tell.
  channel_->SetClient(
      client_receiver_.BindNewPipeAndPassRemote(task_runner));

  // AND THE TRAY, IN THE SAME BREATH, for the same reason: listening is what
  // binds, and a page listening for `extensions` is told the tray as soon as
  // this pipe carries its client. Its own pipe because an action is this
  // browser's, not the compositor's -- see extension_tray.mojom.
  window_->GetBrowserInterfaceBroker().GetInterface(
      tray_.BindNewPipeAndPassReceiver(task_runner));
  tray_->SetClient(tray_receiver_.BindNewPipeAndPassRemote(task_runner));

  ReportGeometry();
  return true;
}

void DomicileHost::ReportGeometry() {
  // WrapWeakPersistent: the listeners belong to the window and its media
  // queries, which can outlive nothing here, but a callback that kept this
  // host alive would keep the channel open for a document that is gone.
  resize_listener_ = MakeGarbageCollected<DesktopResized>(BindRepeating(
      &DomicileHost::ReportDesktopSize, WrapWeakPersistent(this)));
  density_listener_ = MakeGarbageCollected<DensityChanged>(BindRepeating(
      &DomicileHost::ReportDevicePixelRatio, WrapWeakPersistent(this)));
  window_->addEventListener(event_type_names::kResize, resize_listener_.Get());
  ReportDevicePixelRatio();
  ReportDesktopSize();
}

void DomicileHost::ReportDesktopSize() {
  if (!window_ || !channel_.is_bound()) {
    return;
  }
  // CSS pixels, which are the compositor's logical units. The density goes
  // separately and the compositor multiplies.
  channel_->SetDesktopSize(window_->innerWidth(), window_->innerHeight());
}

void DomicileHost::ReportDevicePixelRatio() {
  if (!window_ || !channel_.is_bound()) {
    return;
  }
  const double ratio = window_->devicePixelRatio();
  // Zero or less is not a scale, and the compositor would divide by it.
  if (!(ratio > 0)) {
    return;
  }
  channel_->SetDevicePixelRatio(ratio);

  if (density_query_) {
    density_query_->RemoveListener(density_listener_.Get());
  }
  StringBuilder query;
  query.Append("(resolution: ");
  query.AppendNumber(ratio);
  query.Append("dppx)");
  density_query_ = window_->matchMedia(query.ToString());
  density_query_->AddListener(density_listener_.Get());
}

const FrozenArray<DomicileWindow>& DomicileHost::windows() {
  EnsureBound();
  if (!windows_) {
    windows_ = MakeGarbageCollected<FrozenArray<DomicileWindow>>(
        HeapVector<Member<DomicileWindow>>());
  }
  return *windows_;
}

const FrozenArray<DomicileClipboardEntry>* DomicileHost::clipboard() const {
  return last_clipboard_ ? &last_clipboard_->entries() : nullptr;
}

const FrozenArray<DomicileTrayItem>* DomicileHost::tray() const {
  return last_tray_items_ ? &last_tray_items_->items() : nullptr;
}

const FrozenArray<DomicileNotification>* DomicileHost::notifications() const {
  return last_notifications_ ? &last_notifications_->items() : nullptr;
}

const FrozenArray<DomicileExtension>* DomicileHost::extensions() const {
  return last_extensions_ ? &last_extensions_->extensions() : nullptr;
}

const FrozenArray<DomicileAudioDevice>* DomicileHost::audioOutputs() const {
  return last_audio_ ? &last_audio_->outputs() : nullptr;
}

const FrozenArray<DomicileAudioDevice>* DomicileHost::audioInputs() const {
  return last_audio_ ? &last_audio_->inputs() : nullptr;
}

const FrozenArray<DomicileAudioStream>* DomicileHost::audioPlayback() const {
  return last_audio_ ? &last_audio_->playback() : nullptr;
}

const FrozenArray<DomicileAudioStream>* DomicileHost::audioRecording() const {
  return last_audio_ ? &last_audio_->recording() : nullptr;
}

const FrozenArray<DomicileAudioCard>* DomicileHost::audioCards() const {
  return last_audio_ ? &last_audio_->cards() : nullptr;
}

std::optional<double> DomicileHost::batteryCharge() const {
  return last_battery_ ? std::make_optional(last_battery_->charge())
                       : std::nullopt;
}

std::optional<bool> DomicileHost::batteryCharging() const {
  return last_battery_ ? std::make_optional(last_battery_->charging())
                       : std::nullopt;
}

std::optional<bool> DomicileHost::idle() const {
  return last_idle_ ? std::make_optional(last_idle_->idle()) : std::nullopt;
}

std::optional<bool> DomicileHost::locked() const {
  return last_locked_ ? std::make_optional(last_locked_->locked())
                      : std::nullopt;
}

std::optional<V8DomicileTheme> DomicileHost::theme() const {
  return last_theme_ ? std::make_optional(last_theme_->theme()) : std::nullopt;
}

std::optional<V8DomicileTheme> DomicileHost::windowsTheme() const {
  return last_windows_theme_ ? std::make_optional(last_windows_theme_->theme())
                             : std::nullopt;
}

std::optional<bool> DomicileHost::altKey() const {
  return last_modifiers_ ? std::make_optional(last_modifiers_->altKey())
                         : std::nullopt;
}

std::optional<bool> DomicileHost::ctrlKey() const {
  return last_modifiers_ ? std::make_optional(last_modifiers_->ctrlKey())
                         : std::nullopt;
}

std::optional<bool> DomicileHost::shiftKey() const {
  return last_modifiers_ ? std::make_optional(last_modifiers_->shiftKey())
                         : std::nullopt;
}

std::optional<bool> DomicileHost::metaKey() const {
  return last_modifiers_ ? std::make_optional(last_modifiers_->metaKey())
                         : std::nullopt;
}

DomicileWindowState& DomicileHost::WindowNamed(const String& app_id) {
  for (DomicileWindowState& state : window_states_) {
    if (state.app_id == app_id) {
      return state;
    }
  }
  DomicileWindowState state;
  state.app_id = app_id;
  window_states_.push_back(std::move(state));
  return window_states_.back();
}

namespace {

// Enough for every address and focus request a shell could plausibly miss
// while it loads, and few enough that a page that never listens costs nothing.
constexpr wtf_size_t kMostHeld = 64;

}  // namespace

void DomicileHost::DispatchOrHold(Event& event) {
  if (HasEventListeners(event.type())) {
    DispatchEvent(event);
  } else if (held_.size() < kMostHeld) {
    held_.push_back(&event);
  }
}

void DomicileHost::DeliverHeld(const AtomicString& event_type) {
  HeapVector<Member<Event>> deliver;
  HeapVector<Member<Event>> keep;
  for (const Member<Event>& event : held_) {
    (event->type() == event_type ? deliver : keep).push_back(event);
  }
  held_ = std::move(keep);
  for (const Member<Event>& event : deliver) {
    DispatchEvent(*event);
  }
}

void DomicileHost::WindowsChanged() {
  HeapVector<Member<DomicileWindow>> windows;
  windows.reserve(window_states_.size());
  for (const DomicileWindowState& state : window_states_) {
    windows.push_back(MakeGarbageCollected<DomicileWindow>(state));
  }
  windows_ =
      MakeGarbageCollected<FrozenArray<DomicileWindow>>(std::move(windows));
  DispatchEvent(*Event::Create(domicile_event_names::Windowschanged()));
}

void DomicileHost::spawn(ScriptState* script_state,
                         const Vector<String>& command,
                         ExceptionState& exception_state) {
  // An empty argv reaches the compositor as a request to run nothing, which it
  // cannot answer and should not have to refuse. Caught here so the shell gets
  // a stack rather than silence; the browser refuses it again, because that is
  // where refusing matters.
  if (command.empty()) {
    exception_state.ThrowTypeError(
        "spawn: command must be a non-empty argv array");
    return;
  }
  if (!EnsureBound()) {
    exception_state.ThrowDOMException(
        DOMExceptionCode::kInvalidStateError,
        "There is no compositor for this document to control.");
    return;
  }

  Vector<String> argv;
  argv.reserve(command.size());
  for (const String& argument : command) {
    argv.push_back(argument);
  }
  channel_->Spawn(argv);
}


// Every outbound call needs the same two answers first: is there anything to
// send to, and did the page name a window. Written once rather than twelve
// times, because twelve copies is where one of them ends up missing.
bool DomicileHost::Ready(ExceptionState& exception_state) {
  if (!EnsureBound()) {
    exception_state.ThrowDOMException(
        DOMExceptionCode::kInvalidStateError,
        "There is no compositor for this document to control.");
    return false;
  }
  return true;
}

bool DomicileHost::ReadyForApp(const String& app_id,
                               ExceptionState& exception_state) {
  if (app_id.empty()) {
    exception_state.ThrowTypeError("appId must be a non-empty string");
    return false;
  }
  return Ready(exception_state);
}

void DomicileHost::focusApp(ScriptState*, const String& app_id,
                            ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->FocusApp(app_id);
  }
}

namespace {

// Make the resolver for a new ask and reject the one it supersedes.
template <typename Answer>
ScriptPromiseResolver<Answer>* Supersede(
    Member<ScriptPromiseResolver<Answer>>& outstanding,
    ScriptState* script_state,
    ExceptionState& exception_state) {
  if (outstanding) {
    outstanding->RejectWithDOMException(DOMExceptionCode::kAbortError,
                                        "A newer ask superseded this one.");
  }
  outstanding = MakeGarbageCollected<ScriptPromiseResolver<Answer>>(
      script_state, exception_state.GetContext());
  return outstanding.Get();
}

// Settle the outstanding ask with `answer` if `asked` is what it asked.
template <typename Answer>
void Settle(Member<ScriptPromiseResolver<Answer>>& outstanding,
            const String& outstanding_asked,
            const String& asked,
            Answer* answer) {
  if (outstanding && outstanding_asked == asked) {
    outstanding->Resolve(answer);
    outstanding = nullptr;
  }
}

}  // namespace

ScriptPromise<DomicileFileSearch> DomicileHost::searchFiles(
    ScriptState* script_state,
    const String& query,
    ExceptionState& exception_state) {
  if (!Ready(exception_state)) {
    return EmptyPromise();
  }
  auto* resolver = Supersede(file_search_, script_state, exception_state);
  file_search_query_ = query;
  auto promise = resolver->Promise();
  channel_->SearchFiles(query);
  return promise;
}

ScriptPromise<DomicileFilePreview> DomicileHost::previewFile(
    ScriptState* script_state,
    const String& path,
    ExceptionState& exception_state) {
  if (!Ready(exception_state)) {
    return EmptyPromise();
  }
  auto* resolver = Supersede(file_preview_, script_state, exception_state);
  file_preview_path_ = path;
  auto promise = resolver->Promise();
  channel_->PreviewFile(path);
  return promise;
}

ScriptPromise<DomicileAppSearch> DomicileHost::searchApps(
    ScriptState* script_state,
    const String& query,
    ExceptionState& exception_state) {
  if (!Ready(exception_state)) {
    return EmptyPromise();
  }
  auto* resolver = Supersede(app_search_, script_state, exception_state);
  app_search_query_ = query;
  auto promise = resolver->Promise();
  channel_->SearchApps(query);
  return promise;
}

// The whole of what a page may do about the lock, and it is an offer rather
// than a decision: what opens the desk is the compositor agreeing, and what
// this page hears about it is a `locked` event like every other chrome on the
// desk. A wrong passphrase is answered with nothing -- there is no verdict on
// this channel to leak a guess through, and the compositor's own log says it
// refused one without saying what it was.
//
// No empty-string guard. An empty passphrase is a wrong passphrase, which this
// call already has an answer for, and the compositor refuses an empty one in
// its config too -- so there is nothing here for a throw to tell a shell that
// the refusal does not.
void DomicileHost::unlock(ScriptState*,
                          const String& passphrase,
                          ExceptionState& exception_state) {
  if (Ready(exception_state)) {
    channel_->Unlock(passphrase);
  }
}

// The other way, and just as much a request: what this page hears is the
// `locked` event every chrome on the desk hears.
void DomicileHost::lock(ScriptState*, ExceptionState& exception_state) {
  if (Ready(exception_state)) {
    channel_->Lock();
  }
}

// A request too: what this page hears is the `brightnesschanged` every chrome
// on the desk hears once the backlight has moved.
void DomicileHost::setBrightness(ScriptState*,
                                 double level,
                                 ExceptionState& exception_state) {
  if (Ready(exception_state)) {
    channel_->SetBrightness(level);
  }
}

// The mixer's requests, relayed like setBrightness: what this page hears is
// the `audio` every chrome on the desk hears once the sound server has moved.
// The ids are the compositor's to check -- one it never gave out is a line in
// its log -- so none is read here.
void DomicileHost::setAudioVolume(ScriptState*,
                                  const String& id,
                                  double volume,
                                  ExceptionState& exception_state) {
  if (Ready(exception_state)) {
    channel_->SetAudioVolume(id, volume);
  }
}

void DomicileHost::setAudioMuted(ScriptState*,
                                 const String& id,
                                 bool muted,
                                 ExceptionState& exception_state) {
  if (Ready(exception_state)) {
    channel_->SetAudioMuted(id, muted);
  }
}

void DomicileHost::setDefaultAudioDevice(ScriptState*,
                                         const String& id,
                                         ExceptionState& exception_state) {
  if (Ready(exception_state)) {
    channel_->SetDefaultAudioDevice(id);
  }
}

void DomicileHost::moveAudioStream(ScriptState*,
                                   const String& id,
                                   const String& device,
                                   ExceptionState& exception_state) {
  if (Ready(exception_state)) {
    channel_->MoveAudioStream(id, device);
  }
}

void DomicileHost::setAudioPort(ScriptState*,
                                const String& id,
                                const String& port,
                                ExceptionState& exception_state) {
  if (Ready(exception_state)) {
    channel_->SetAudioPort(id, port);
  }
}

void DomicileHost::setAudioProfile(ScriptState*,
                                   const String& card,
                                   const String& profile,
                                   ExceptionState& exception_state) {
  if (Ready(exception_state)) {
    channel_->SetAudioProfile(card, profile);
  }
}

// An empty list is a page letting go, which is an ask like any other.
void DomicileHost::watchAudioLevels(ScriptState*,
                                    const Vector<String>& ids,
                                    ExceptionState& exception_state) {
  if (Ready(exception_state)) {
    channel_->WatchAudioLevels(ids);
  }
}

// The whole of what a page may do to the seat's clipboard, and it names a row
// rather than carrying text: a call that took bytes would let this document
// write the desktop's clipboard, where this one only chooses among what has
// already been copied on it. An id the compositor no longer holds sets
// nothing, and it says so in its own log -- there is no answer to this for it
// to say so in.
void DomicileHost::copyClipboardEntry(ScriptState*,
                                      uint32_t entry,
                                      ExceptionState& exception_state) {
  if (Ready(exception_state)) {
    channel_->CopyClipboardEntry(entry);
  }
}

void DomicileHost::focusChrome(ScriptState*, ExceptionState& exception_state) {
  if (Ready(exception_state)) {
    channel_->FocusChrome();
  }
}

void DomicileHost::warpPointer(ScriptState*, double x, double y,
                               ExceptionState& exception_state) {
  // A coordinate that is not a number is not a place, and every arithmetic
  // that follows it -- the browser's clamp into this page's box, the round to
  // a pixel -- would carry it. Refused here because the page is where the
  // mistake is, the way a device pixel ratio of zero is.
  //
  // A coordinate OUTSIDE this page is not refused: it is clamped to the page's
  // own box in the browser process, which is where the box is known. See
  // `PointerWarpTarget`.
  if (!std::isfinite(x) || !std::isfinite(y)) {
    exception_state.ThrowTypeError("warpPointer: x and y must be finite");
    return;
  }
  if (Ready(exception_state)) {
    channel_->WarpPointer(x, y);
  }
}

void DomicileHost::closeApp(ScriptState*, const String& app_id,
                            ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->CloseApp(app_id);
  }
}

void DomicileHost::resizeApp(ScriptState*, const String& app_id, double width,
                             double height,
                             ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->ResizeApp(app_id, width, height);
  }
}

// THROUGH THE WIRE NAME, for the reason `AppCursor` below reads one: the only
// mapping between `DomicileTheme` and `mojom::Theme` in either direction is
// the X-macro in components/domicile/common/theme.h, so the list stays
// singular and scripts/test-themes-agree.sh can read every writing of it.
//
// No argument guard, and nothing to guard: the bindings have already refused
// anything that is not one of the two, which is what the enum in
// domicile_theme.idl is for. The `CHECK` is the same unreachable assertion
// `AppCursor` makes, pointing the other way -- it fires only if the .idl and
// the X-macro have drifted, which is a build this repository should not have
// produced.
namespace {

domicile::mojom::blink::Theme MojoTheme(V8DomicileTheme theme) {
  const std::optional<domicile::mojom::blink::Theme> mode =
      domicile::ThemeFromWire<domicile::mojom::blink::Theme>(
          theme.AsString().Utf8());
  CHECK(mode.has_value()) << "no theme named '" << theme.AsString().Utf8()
                          << "', so domicile_theme.idl and theme.h disagree";
  return *mode;
}

V8DomicileTheme PageTheme(domicile::mojom::blink::Theme theme) {
  const std::string_view name = domicile::ThemeToWire(theme);
  const std::optional<V8DomicileTheme> mode =
      V8DomicileTheme::Create(String::FromUtf8(name));
  CHECK(mode.has_value()) << "no DomicileTheme named '" << name
                          << "', so domicile_theme.idl and theme.h disagree";
  return *mode;
}

// A switch rather than a wire name: the button goes no further than this
// channel's own mojom, which the compositor never reads.
domicile::mojom::blink::TrayAction MojoTrayAction(V8DomicileTrayAction action) {
  switch (action.AsEnum()) {
    case V8DomicileTrayAction::Enum::kPrimary:
      return domicile::mojom::blink::TrayAction::kPrimary;
    case V8DomicileTrayAction::Enum::kSecondary:
      return domicile::mojom::blink::TrayAction::kSecondary;
    case V8DomicileTrayAction::Enum::kContext:
      return domicile::mojom::blink::TrayAction::kContext;
  }
}

}  // namespace

// An icon and a button, and nothing about what the click does. An empty id
// throws, as activateExtension's does: it is a shell that forgot to say which
// icon, rather than one that raced an application going away.
void DomicileHost::activateTrayItem(ScriptState*,
                                    const String& id,
                                    V8DomicileTrayAction action,
                                    ExceptionState& exception_state) {
  if (id.empty()) {
    exception_state.ThrowTypeError("id must be a non-empty tray item id");
    return;
  }
  if (Ready(exception_state)) {
    channel_->ActivateTrayItem(id, MojoTrayAction(action));
  }
}

// Ids and nothing else. An empty list is a shell that cleared nothing, which is
// not an error and asks nothing of the compositor.
void DomicileHost::dismissNotifications(ScriptState*,
                                        const Vector<uint32_t>& ids,
                                        ExceptionState& exception_state) {
  if (ids.empty()) {
    return;
  }
  if (Ready(exception_state)) {
    channel_->DismissNotifications(ids);
  }
}

// A notification and a key, and nothing about what the press does. An empty
// key throws, as activateTrayItem's empty id does: it is a shell that forgot to
// say which button, rather than one that raced the notification going away.
void DomicileHost::invokeNotificationAction(ScriptState*,
                                            uint32_t id,
                                            const String& action,
                                            ExceptionState& exception_state) {
  if (action.empty()) {
    exception_state.ThrowTypeError(
        "action must be a non-empty notification action key");
    return;
  }
  if (Ready(exception_state)) {
    channel_->InvokeNotificationAction(id, action);
  }
}

void DomicileHost::setTheme(ScriptState*, V8DomicileTheme theme,
                            ExceptionState& exception_state) {
  // `Ready` first, which every other member here does and this one did not:
  // a call on a host whose channel is not up throws, and doing the lookup and
  // the assertion in front of that would be work on the way to a throw.
  if (Ready(exception_state)) {
    channel_->SetTheme(MojoTheme(theme));
  }
}

void DomicileHost::themeCaptured(ScriptState*, V8DomicileTheme theme,
                                 ExceptionState& exception_state) {
  if (Ready(exception_state)) {
    channel_->ThemeCaptured(MojoTheme(theme));
  }
}

void DomicileHost::grabShortcut(ScriptState*, const DomicileShortcut* shortcut,
                                ExceptionState& exception_state) {
  // Keycode 0 is not a key. A combination of modifiers alone would fire on
  // every keystroke that happens to hold them, which is not a shortcut and is
  // indistinguishable from the page forgetting to say which key it meant.
  if (!shortcut->keycode()) {
    exception_state.ThrowTypeError("keycode must be a non-zero evdev code");
    return;
  }
  if (Ready(exception_state)) {
    channel_->GrabShortcut(domicile::mojom::blink::Shortcut::New(
        shortcut->keycode(), shortcut->altKey(), shortcut->ctrlKey(),
        shortcut->shiftKey(), shortcut->metaKey()));
  }
}

void DomicileHost::grabShortcut(ScriptState*,
                                const String& written,
                                ExceptionState& exception_state) {
  String error;
  const std::optional<DomicileWrittenChord> chord =
      ParseDomicileChord(written, &error);
  if (!chord) {
    exception_state.ThrowDOMException(DOMExceptionCode::kSyntaxError, error);
    return;
  }
  // A keyboard already heard can say now that the keysym is on no key. One
  // not heard yet says so when it arrives, as a warning: the page has long
  // since returned.
  if (keys_ && !ResolveDomicileChord(*chord, *keys_)) {
    exception_state.ThrowDOMException(
        DOMExceptionCode::kNotFoundError,
        "chord \"" + written + "\": \"" + chord->keysym +
            "\" is on no key of this keyboard");
    return;
  }
  if (!Ready(exception_state)) {
    return;
  }
  for (const GrabbedChord& grabbed : chords_) {
    if (grabbed.written == written) {
      return;
    }
  }
  chords_.push_back(GrabbedChord{written, *chord, std::nullopt});
  if (!key_listener_) {
    key_listener_ = MakeGarbageCollected<PageKeyPressed>(BindRepeating(
        &DomicileHost::PageKeyDown, WrapWeakPersistent(this)));
    // Capturing, on the window: first of anything on the page, so a forward
    // of keys to an `<app>` sees the chord already taken (`defaultPrevented`)
    // and leaves it.
    window_->addEventListener(event_type_names::kKeydown, key_listener_.Get(),
                              /*use_capture=*/true);
  }
  ResolveChords();
}

// A claim is never given back -- the channel has no way to release one -- so a
// chord whose key moved is grabbed on its new key and the old one stays the
// desktop's, answering nothing, until the page reloads.
void DomicileHost::ResolveChords() {
  if (!keys_ || !channel_.is_bound()) {
    return;
  }
  for (GrabbedChord& grabbed : chords_) {
    const std::optional<DomicilePress> press =
        ResolveDomicileChord(grabbed.chord, *keys_);
    if (!press) {
      if (window_) {
        window_->AddConsoleMessage(MakeGarbageCollected<ConsoleMessage>(
            mojom::blink::ConsoleMessageSource::kJavaScript,
            mojom::blink::ConsoleMessageLevel::kWarning,
            "domicile: chord \"" + grabbed.written + "\": \"" +
                grabbed.chord.keysym + "\" is on no key of this keyboard"));
      }
    } else if (press != grabbed.press) {
      channel_->GrabShortcut(domicile::mojom::blink::Shortcut::New(
          press->keycode, press->alt, press->ctrl, press->shift, press->meta));
    }
    grabbed.press = press;
  }
}

String DomicileHost::ChordFor(const DomicilePress& press) const {
  for (const GrabbedChord& grabbed : chords_) {
    if (grabbed.press == press) {
      return grabbed.written;
    }
  }
  return String();
}

void DomicileHost::PageKeyDown(Event* event) {
  auto* key = DynamicTo<KeyboardEvent>(event);
  if (!key) {
    return;
  }
  const int evdev = ui::KeycodeConverter::DomCodeToEvdevCode(
      ui::KeycodeConverter::CodeStringToDomCode(key->code().Utf8()));
  if (evdev <= 0) {
    return;
  }
  const DomicilePress press{static_cast<uint32_t>(evdev), key->altKey(),
                            key->ctrlKey(), key->shiftKey(), key->metaKey()};
  const String chord = ChordFor(press);
  if (chord.IsNull()) {
    return;
  }
  // Taken from the page whether or not it fires: the chord is the desktop's
  // for as long as it is held. A held key repeats; the compositor never sees a
  // repeat, so neither does the shell.
  event->preventDefault();
  if (key->repeat()) {
    return;
  }
  DispatchOrHold(*MakeGarbageCollected<DomicileShortcutEvent>(
      domicile_event_names::Shortcut(), chord, press.keycode, press.alt,
      press.ctrl, press.shift, press.meta, Arrival(key->PlatformTimeStamp())));
}

// Through the tray's pipe rather than the channel's: see the IDL. Ready()
// because EnsureBound binds the two together, so a bound channel is a bound
// tray.
void DomicileHost::activateExtension(ScriptState*,
                                     const String& id,
                                     ExceptionState& exception_state) {
  if (id.empty()) {
    exception_state.ThrowTypeError("id must be a non-empty extension id");
    return;
  }
  if (Ready(exception_state)) {
    tray_->Activate(id);
  }
}

void DomicileHost::key(ScriptState*, const String& app_id, uint32_t keycode,
                       bool pressed, ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->Key(app_id, keycode, pressed);
  }
}

void DomicileHost::pointerMotion(ScriptState*, const String& app_id, double x,
                                 double y, ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->PointerMotion(app_id, x, y);
  }
}

void DomicileHost::pointerLeave(ScriptState*, const String& app_id,
                                ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->PointerLeave(app_id);
  }
}

void DomicileHost::pointerButton(ScriptState*, const String& app_id,
                                 uint32_t button, bool pressed,
                                 ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->PointerButton(app_id, button, pressed);
  }
}

void DomicileHost::pointerAxis(ScriptState*, const String& app_id, double dx,
                               double dy, int32_t v120_x, int32_t v120_y,
                               ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    channel_->PointerAxis(app_id, dx, dy, v120_x, v120_y);
  }
}

void DomicileHost::AppAppeared(const String& app_id, const String& title,
                               bool has_size, double width, double height,
                               base::TimeTicks arrival) {
  DomicileWindowState& state = WindowNamed(app_id);
  state.title = title;
  if (has_size) {
    state.width = width;
    state.height = height;
  }
  WindowsChanged();
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      domicile_event_names::Appappeared(), app_id, title,
      has_size ? std::make_optional(width) : std::nullopt,
      has_size ? std::make_optional(height) : std::nullopt, Arrival(arrival)));
}

void DomicileHost::AppResized(const String& app_id, double width, double height,
                              base::TimeTicks arrival) {
  DomicileWindowState& state = WindowNamed(app_id);
  state.width = width;
  state.height = height;
  WindowsChanged();
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      domicile_event_names::Appresized(), app_id, String(), width, height,
      Arrival(arrival)));
}

void DomicileHost::AppMinSize(const String& app_id, double width, double height,
                              base::TimeTicks arrival) {
  DomicileWindowState& state = WindowNamed(app_id);
  state.min_width = width;
  state.min_height = height;
  WindowsChanged();
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      domicile_event_names::Appminsize(), app_id, String(), width, height,
      Arrival(arrival)));
}

void DomicileHost::AppMaxSize(const String& app_id, double width, double height,
                              base::TimeTicks arrival) {
  DomicileWindowState& state = WindowNamed(app_id);
  state.max_width = width;
  state.max_height = height;
  WindowsChanged();
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      domicile_event_names::Appmaxsize(), app_id, String(), width, height,
      Arrival(arrival)));
}

void DomicileHost::PopupPlaced(const String& app_id,
                               const String& parent_app_id,
                               double x,
                               double y,
                               double width,
                               double height,
                               bool grab,
                               base::TimeTicks arrival) {
  DomicileWindowState& state = WindowNamed(app_id);
  state.parent = parent_app_id;
  state.x = x;
  state.y = y;
  state.width = width;
  state.height = height;
  state.grab = grab;
  WindowsChanged();
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      domicile_event_names::Popupplaced(), app_id, parent_app_id, x, y, width,
      height, grab, Arrival(arrival)));
}

void DomicileHost::AppClosed(const String& app_id, base::TimeTicks arrival) {
  EraseIf(window_states_, [&](const DomicileWindowState& state) {
    return state.app_id == app_id;
  });
  WindowsChanged();
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      domicile_event_names::Appclosed(), app_id, String(), std::nullopt,
      std::nullopt, Arrival(arrival)));
}

void DomicileHost::AppCursor(const String& app_id,
                             domicile::mojom::blink::CursorShape cursor,
                             base::TimeTicks arrival) {
  // THROUGH THE WIRE NAME, WHICH IS WHAT KEEPS THE LIST SINGULAR. The mojom
  // enum and `DomicileCursorShape` are two spellings of the same closed set,
  // and the obvious conversion between them is a 35-arm switch -- a third
  // hand-written list, which is one more than can be kept honest and which
  // `scripts/test-cursor-shapes-agree.sh` could not read. Going via the string
  // instead means the only mapping either direction is the X-macro in
  // components/domicile/common/cursor_shape.h, and every list that exists is
  // one that script compares.
  //
  // The `CHECK` is unreachable rather than defensive: `Create` is refusing a
  // name that is not a shape, and the name came from `CursorShapeToWire` over
  // a mojo-validated enum. What would reach it is the .idl and the X-macro
  // having drifted, which is a build this repository should not have produced
  // -- so it fails here, loudly, instead of dispatching an arrow.
  const std::string_view name = domicile::CursorShapeToWire(cursor);
  const std::optional<V8DomicileCursorShape> shape =
      V8DomicileCursorShape::Create(String::FromUtf8(name));
  CHECK(shape.has_value())
      << "no DomicileCursorShape named '" << name
      << "', so domicile_cursor_shape.idl and cursor_shape.h disagree";
  WindowNamed(app_id).cursor = *shape;
  WindowsChanged();
  DispatchEvent(*MakeGarbageCollected<DomicileAppCursorEvent>(
      domicile_event_names::Appcursor(), app_id, *shape, Arrival(arrival)));
}

void DomicileHost::ShortcutPressed(domicile::mojom::blink::ShortcutPtr shortcut,
                                   base::TimeTicks arrival) {
  const DomicilePress press{shortcut->keycode, shortcut->alt, shortcut->ctrl,
                            shortcut->shift, shortcut->meta};
  DispatchOrHold(*MakeGarbageCollected<DomicileShortcutEvent>(
      domicile_event_names::Shortcut(), ChordFor(press), shortcut->keycode,
      shortcut->alt, shortcut->ctrl, shortcut->shift, shortcut->meta,
      Arrival(arrival)));
}

void DomicileHost::Modifiers(bool alt, bool ctrl, bool shift, bool meta,
                             base::TimeTicks arrival) {
  last_modifiers_ = MakeGarbageCollected<DomicileModifiersEvent>(
      domicile_event_names::Modifiers(), alt, ctrl, shift, meta,
      Arrival(arrival));
  DispatchEvent(*last_modifiers_);
  DispatchEvent(*Event::Create(domicile_event_names::Modifierschanged()));
}

// The wire name of a turn, as the page reads it off `DomicileDisplay`.
//
// THROUGH THE WIRE NAME, for the reason `AppCursor` above goes through one:
// the only mapping in either direction is the X-macro in
// components/domicile/common/display_transform.h, so there is no second list
// to drift from the first. No `Create` and no `CHECK` here, because the
// attribute is a `DOMString` rather than a generated enum -- the set is closed
// on the compositor's side and on the page's schema, and this is the middle.
namespace {

String TransformName(domicile::mojom::blink::DisplayTransform transform) {
  return String::FromUtf8(domicile::DisplayTransformToWire(transform));
}

}  // namespace

void DomicileHost::Displays(
    Vector<domicile::mojom::blink::DisplayInfoPtr> displays) {
  HeapVector<Member<DomicileDisplay>> described;
  described.reserve(displays.size());
  for (const auto& display : displays) {
    described.push_back(MakeGarbageCollected<DomicileDisplay>(
        display->name, display->x, display->y, display->width, display->height,
        display->scale, display->mode_width, display->mode_height,
        TransformName(display->transform)));
  }
  displays_ = MakeGarbageCollected<FrozenArray<DomicileDisplay>>(
      std::move(described));
  // The event says the desktop moved; `displays` says what it is. Splitting
  // them is what lets a component that mounted after the description read the
  // desktop at all -- an event carrying the only copy is gone once dispatched.
  DispatchEvent(*Event::Create(domicile_event_names::Displayschanged()));
}

// The whole tray, as rows a shell draws. An empty popup is WebIDL's null --
// see DomicileExtension -- because an action with no popup has nothing for the
// shell to open, and "" is not an address to open.
void DomicileHost::ExtensionsChanged(
    Vector<domicile::mojom::blink::TrayExtensionPtr> extensions) {
  HeapVector<Member<DomicileExtension>> tray;
  tray.reserve(extensions.size());
  for (const auto& extension : extensions) {
    tray.push_back(MakeGarbageCollected<DomicileExtension>(
        extension->id, extension->name, extension->title, extension->icon,
        extension->badge_text, extension->badge_color,
        extension->popup.empty() ? String() : extension->popup,
        extension->enabled));
  }
  last_extensions_ = MakeGarbageCollected<DomicileExtensionsEvent>(
      domicile_event_names::Extensions(), std::move(tray));
  DispatchEvent(*last_extensions_);
  DispatchEvent(*Event::Create(domicile_event_names::Extensionschanged()));
}

// An answer to searchFiles(): it settles the promise that asked it, and is
// also dispatched as a `files` event for the shells that still listen for one.
void DomicileHost::Files(const String& query,
                         const Vector<String>& files,
                         uint32_t matched,
                         bool indexing,
                         base::TimeTicks arrival) {
  auto* answer = DomicileFileSearch::Create();
  answer->setFiles(files);
  answer->setMatched(matched);
  answer->setIndexing(indexing);
  Settle(file_search_, file_search_query_, query, answer);
  DispatchEvent(*MakeGarbageCollected<DomicileFilesEvent>(
      domicile_event_names::Files(), query, files, matched, indexing,
      Arrival(arrival)));
}

// An answer, like Files: the path is the one previewFile() was given, and it
// comes back so a launcher can drop the preview of a row it has since left.
void DomicileHost::FilePreview(const String& path,
                               const String& kind,
                               const String& text,
                               const Vector<String>& entries,
                               const String& title,
                               const String& artist,
                               const String& album,
                               double duration,
                               const String& cover,
                               base::TimeTicks arrival) {
  auto* answer = DomicileFilePreview::Create();
  answer->setKind(kind);
  answer->setText(text);
  answer->setEntries(entries);
  answer->setTitle(title);
  answer->setArtist(artist);
  answer->setAlbum(album);
  answer->setDuration(duration);
  answer->setCover(cover);
  Settle(file_preview_, file_preview_path_, path, answer);
  DispatchEvent(*MakeGarbageCollected<DomicileFilePreviewEvent>(
      domicile_event_names::Filepreview(), path, kind, text, entries, title,
      artist, album, duration, cover, Arrival(arrival)));
}

// An answer, like Files. The entries are built here rather than carried as
// parallel arrays because what a launcher draws and runs is an entry -- see
// `domicile_desktop_entry.h`.
void DomicileHost::Apps(const String& query,
                        Vector<domicile::mojom::blink::DesktopEntryPtr> apps,
                        Vector<domicile::mojom::blink::BookmarkPtr> bookmarks,
                        base::TimeTicks arrival) {
  HeapVector<Member<DomicileDesktopEntry>> entries;
  entries.reserve(apps.size());
  for (auto& app : apps) {
    entries.push_back(MakeGarbageCollected<DomicileDesktopEntry>(
        app->id, app->name, app->comment, std::move(app->command),
        app->icon, app->preview));
  }
  HeapVector<Member<DomicileBookmark>> marked;
  marked.reserve(bookmarks.size());
  for (auto& bookmark : bookmarks) {
    marked.push_back(MakeGarbageCollected<DomicileBookmark>(
        bookmark->name, bookmark->url, bookmark->icon));
  }
  auto* answer = DomicileAppSearch::Create();
  answer->setApps(entries);
  answer->setBookmarks(marked);
  Settle(app_search_, app_search_query_, query, answer);
  DispatchEvent(*MakeGarbageCollected<DomicileAppsEvent>(
      domicile_event_names::Apps(), query, std::move(entries),
      std::move(marked), Arrival(arrival)));
}

// Pushed, so there is no ask for this to be the answer to. The compositor
// polls the kernel's files and sends one of these when the reading moves far
// enough to draw -- see `domicile_host::battery`, which is also where the
// reason a page cannot read this for itself is written down.
void DomicileHost::Battery(double charge,
                           bool charging,
                           base::TimeTicks arrival) {
  last_battery_ = MakeGarbageCollected<DomicileBatteryEvent>(
      domicile_event_names::Battery(), charge, charging, Arrival(arrival));
  DispatchEvent(*last_battery_);
  DispatchEvent(*Event::Create(domicile_event_names::Batterychanged()));
}

// Kept, like Displays: the event says the brightness moved and the attribute
// says where it is, so a slider that mounts later still has a reading.
void DomicileHost::Brightness(double level) {
  brightness_ = level;
  DispatchEvent(*Event::Create(domicile_event_names::Brightnesschanged()));
}

// Pushed, like Battery and unlike Files: the compositor hears a copy without
// anybody asking. The rows are built here rather than carried as two arrays
// because what a panel draws is a row -- see `domicile_clipboard_entry.h`.
void DomicileHost::Clipboard(
    Vector<domicile::mojom::blink::ClipboardEntryPtr> entries,
    base::TimeTicks arrival) {
  HeapVector<Member<DomicileClipboardEntry>> history;
  history.reserve(entries.size());
  for (const auto& entry : entries) {
    history.push_back(MakeGarbageCollected<DomicileClipboardEntry>(
        entry->id, entry->preview));
  }
  last_clipboard_ = MakeGarbageCollected<DomicileClipboardEvent>(
      domicile_event_names::Clipboard(), std::move(history), Arrival(arrival));
  DispatchEvent(*last_clipboard_);
  DispatchEvent(*Event::Create(domicile_event_names::Clipboardchanged()));
}

// Pushed, like Clipboard: an icon is the session bus's, which the compositor
// hears without anybody asking.
void DomicileHost::Tray(Vector<domicile::mojom::blink::TrayItemPtr> items,
                        base::TimeTicks arrival) {
  HeapVector<Member<DomicileTrayItem>> tray;
  tray.reserve(items.size());
  for (const auto& item : items) {
    tray.push_back(MakeGarbageCollected<DomicileTrayItem>(item->id, item->title,
                                                          item->icon));
  }
  last_tray_items_ = MakeGarbageCollected<DomicileTrayEvent>(
      domicile_event_names::Tray(), std::move(tray), Arrival(arrival));
  DispatchEvent(*last_tray_items_);
  DispatchEvent(*Event::Create(domicile_event_names::Traychanged()));
}

// Pushed, like Tray: a notification is a call on the session bus, which the
// compositor hears without anybody asking.
void DomicileHost::Notifications(
    Vector<domicile::mojom::blink::NotificationPtr> items,
    base::TimeTicks arrival) {
  HeapVector<Member<DomicileNotification>> notifications;
  notifications.reserve(items.size());
  for (const auto& item : items) {
    HeapVector<Member<DomicileNotificationAction>> actions;
    actions.reserve(item->actions.size());
    for (const auto& action : item->actions) {
      actions.push_back(MakeGarbageCollected<DomicileNotificationAction>(
          action->key, action->label));
    }
    notifications.push_back(MakeGarbageCollected<DomicileNotification>(
        item->id, item->app_name, item->summary, item->body, item->icon,
        item->urgency, std::move(actions), item->clickable, item->timeout_ms,
        item->time));
  }
  last_notifications_ = MakeGarbageCollected<DomicileNotificationsEvent>(
      domicile_event_names::Notifications(), std::move(notifications),
      Arrival(arrival));
  DispatchEvent(*last_notifications_);
  DispatchEvent(*Event::Create(domicile_event_names::Notificationschanged()));
}

// Pushed, like Battery, and the one pushed message this page can cause:
// `setTheme` above is answered with it, to every chrome on the desk rather
// than to the one that called. Through the wire name, for `AppCursor`'s
// reason and with `AppCursor`'s unreachable CHECK.
void DomicileHost::ThemeChanged(domicile::mojom::blink::Theme theme,
                                base::TimeTicks arrival) {
  last_theme_ = MakeGarbageCollected<DomicileThemeEvent>(
      domicile_event_names::Theme(), PageTheme(theme), Arrival(arrival));
  DispatchEvent(*last_theme_);
  DispatchEvent(*Event::Create(domicile_event_names::Themechanged()));
}

// The same event interface as `theme`, under its own type: what it carries is
// the same closed set, about the desk's windows rather than its chrome.
void DomicileHost::WindowsThemeChanged(domicile::mojom::blink::Theme theme,
                                       base::TimeTicks arrival) {
  last_windows_theme_ = MakeGarbageCollected<DomicileThemeEvent>(
      domicile_event_names::Windowstheme(), PageTheme(theme), Arrival(arrival));
  DispatchEvent(*last_windows_theme_);
  DispatchEvent(*Event::Create(domicile_event_names::Windowsthemechanged()));
}

// Pushed like Battery, and a state rather than an edge -- the compositor
// decides the edge, because lighting a connector is a modeset and a dark desk
// must not ask for one per tick, and then sends where the desk stands so that
// a page which has only just loaded is not left drawing a desktop somebody is
// at. See `crate::idle` in the compositor.
void DomicileHost::Idle(bool idle, base::TimeTicks arrival) {
  last_idle_ = MakeGarbageCollected<DomicileIdleEvent>(
      domicile_event_names::Idle(), idle, Arrival(arrival));
  DispatchEvent(*last_idle_);
  DispatchEvent(*Event::Create(domicile_event_names::Idlechanged()));
}

// Pushed like Idle above, and a state for its reason with the stakes the other
// way up: the edge a reloaded page missed is the one that would have raised its
// lock screen, and the compositor holding the lock is what makes a reload
// something the desk survives rather than something that opens it. See
// `crate::lock` in the compositor.
void DomicileHost::Locked(bool locked, base::TimeTicks arrival) {
  last_locked_ = MakeGarbageCollected<DomicileLockedEvent>(
      domicile_event_names::Locked(), locked, Arrival(arrival));
  DispatchEvent(*last_locked_);
  DispatchEvent(*Event::Create(domicile_event_names::Lockedchanged()));
}

// Pushed like ThemeChanged, and handed on as the line it arrived as: a shell's
// options are freeform, so the page parses `config` for itself. See
// ControlChannelClient::ShellConfig.
void DomicileHost::ShellConfig(const String& config, base::TimeTicks arrival) {
  // The keys, for the chords grabbed by name. A line without them leaves the
  // last keyboard heard in place: the browser forwards only what parsed.
  if (std::unique_ptr<JSONObject> parsed = JSONObject::From(ParseJSON(config))) {
    if (JSONObject* keys = parsed->GetJSONObject("keys")) {
      HashMap<String, uint32_t> read;
      for (wtf_size_t at = 0; at < keys->size(); ++at) {
        const JSONObject::Entry entry = keys->at(at);
        int keycode = 0;
        if (entry.second->AsInteger(&keycode) && keycode > 0) {
          read.Set(entry.first, static_cast<uint32_t>(keycode));
        }
      }
      keys_ = std::move(read);
      ResolveChords();
    }
  }
  DispatchEvent(*MakeGarbageCollected<DomicileShellConfigEvent>(
      domicile_event_names::Shellconfig(), config, Arrival(arrival)));
}

namespace {

HeapVector<Member<DomicileAudioChoice>> AudioChoices(
    const Vector<domicile::mojom::blink::AudioChoicePtr>& choices) {
  HeapVector<Member<DomicileAudioChoice>> made;
  made.reserve(choices.size());
  for (const auto& choice : choices) {
    made.push_back(MakeGarbageCollected<DomicileAudioChoice>(
        choice->name, choice->description, choice->available));
  }
  return made;
}

HeapVector<Member<DomicileAudioDevice>> AudioDevices(
    const Vector<domicile::mojom::blink::AudioDevicePtr>& devices) {
  HeapVector<Member<DomicileAudioDevice>> made;
  made.reserve(devices.size());
  for (const auto& device : devices) {
    made.push_back(MakeGarbageCollected<DomicileAudioDevice>(
        device->id, device->description, device->volume, device->muted,
        device->is_default, device->monitor, AudioChoices(device->ports),
        device->port));
  }
  return made;
}

HeapVector<Member<DomicileAudioStream>> AudioStreams(
    const Vector<domicile::mojom::blink::AudioStreamPtr>& streams) {
  HeapVector<Member<DomicileAudioStream>> made;
  made.reserve(streams.size());
  for (const auto& stream : streams) {
    made.push_back(MakeGarbageCollected<DomicileAudioStream>(
        stream->id, stream->application, stream->title, stream->volume,
        stream->muted, stream->device));
  }
  return made;
}

HeapVector<Member<DomicileAudioCard>> AudioCards(
    const Vector<domicile::mojom::blink::AudioCardPtr>& cards) {
  HeapVector<Member<DomicileAudioCard>> made;
  made.reserve(cards.size());
  for (const auto& card : cards) {
    made.push_back(MakeGarbageCollected<DomicileAudioCard>(
        card->id, card->description, AudioChoices(card->profiles),
        card->profile));
  }
  return made;
}

}  // namespace

// Pushed, like Notifications: the compositor hears the sound server without
// anybody asking, and the mixer's own requests come back this way.
void DomicileHost::Audio(
    Vector<domicile::mojom::blink::AudioDevicePtr> outputs,
    Vector<domicile::mojom::blink::AudioDevicePtr> inputs,
    Vector<domicile::mojom::blink::AudioStreamPtr> playback,
    Vector<domicile::mojom::blink::AudioStreamPtr> recording,
    Vector<domicile::mojom::blink::AudioCardPtr> cards,
    base::TimeTicks arrival) {
  last_audio_ = MakeGarbageCollected<DomicileAudioEvent>(
      domicile_event_names::Audio(), AudioDevices(outputs),
      AudioDevices(inputs), AudioStreams(playback), AudioStreams(recording),
      AudioCards(cards), Arrival(arrival));
  DispatchEvent(*last_audio_);
  DispatchEvent(*Event::Create(domicile_event_names::Audiochanged()));
}

// Pushed while anything is metered, as rows like every list here.
void DomicileHost::AudioLevels(
    Vector<domicile::mojom::blink::AudioLevelPtr> levels,
    base::TimeTicks arrival) {
  HeapVector<Member<DomicileAudioLevel>> made;
  made.reserve(levels.size());
  for (const auto& level : levels) {
    made.push_back(
        MakeGarbageCollected<DomicileAudioLevel>(level->id, level->peak));
  }
  DispatchEvent(*MakeGarbageCollected<DomicileAudioLevelsEvent>(
      domicile_event_names::Audiolevels(), std::move(made), Arrival(arrival)));
}

void DomicileHost::FocusChanged(const String& app_id,
                                base::TimeTicks arrival) {
  // Empty is the shell's page holding the keyboard, which `focusedWindow`
  // says as null.
  //
  // Dispatched for every word the compositor says about the keyboard, not
  // only when it moves: the first is also the end of the windows replayed to
  // a channel that has just bound, and a shell that waits for it is how it
  // tells a window opened now from one that was already running.
  focused_window_ = app_id.empty() ? String() : app_id;
  DispatchEvent(*Event::Create(domicile_event_names::Focusedwindowchanged()));
  DispatchEvent(*MakeGarbageCollected<DomicileAppEvent>(
      domicile_event_names::Focuschanged(), app_id, String(), std::nullopt,
      std::nullopt, Arrival(arrival)));
}

// The same event shape as FocusChanged and deliberately a different event: one
// says where the keyboard went and this one says a client would like it. A
// page that conflated them would grant every request by drawing it as granted.
void DomicileHost::FocusRequested(const String& app_id,
                                  base::TimeTicks arrival) {
  DispatchOrHold(*MakeGarbageCollected<DomicileAppEvent>(
      domicile_event_names::Focusrequested(), app_id, String(), std::nullopt,
      std::nullopt, Arrival(arrival)));
}

void DomicileHost::OpenUrl(const String& url) {
  DispatchOrHold(*MakeGarbageCollected<DomicileOpenUrlEvent>(
      domicile_event_names::Openurl(), url));
}

void DomicileHost::AppTitled(const String& app_id, const String& title,
                             base::TimeTicks arrival) {
  WindowNamed(app_id).title = title;
  WindowsChanged();
  DispatchEvent(*MakeGarbageCollected<DomicileAppTitledEvent>(
      domicile_event_names::Apptitled(), app_id, title, Arrival(arrival)));
}

// THE BROWSER'S CLOCK, READ ON THIS DOCUMENT'S. `base::TimeTicks` is monotonic
// and process-agnostic -- the same tick means the same instant in the browser
// and here -- but it is not what a page can subtract from: `Event.timeStamp`
// and `performance.now()` are milliseconds since this document's time origin.
// `WindowPerformance` is what holds that origin, so it is what converts.
//
// It also applies the same resolution clamp every other timestamp the page can
// read goes through, which matters: an unclamped one would be a higher
// resolution timer than the platform means a page to have.
DOMHighResTimeStamp DomicileHost::Arrival(base::TimeTicks arrival) const {
  return DOMWindowPerformance::performance(*window_)
      ->MonotonicTimeToDOMHighResTimeStamp(arrival);
}

const AtomicString& DomicileHost::InterfaceName() const {
  return event_target_names::kDomicileHost;
}

void DomicileHost::AddedEventListener(
    const AtomicString& event_type,
    RegisteredEventListener& registered_listener) {
  EventTarget::AddedEventListener(event_type, registered_listener);
  // On a task of its own rather than now: the listener is being added inside
  // the page's own `addEventListener` call, which should return before
  // anything is dispatched to it.
  for (const Member<Event>& event : held_) {
    if (event->type() == event_type) {
      if (window_) {
        window_->GetTaskRunner(TaskType::kInternalDefault)
            ->PostTask(FROM_HERE,
                       BindOnce(&DomicileHost::DeliverHeld,
                                WrapWeakPersistent(this), event_type));
      }
      break;
    }
  }
  // Binding is what opens the inbound direction, so a listener registered
  // before anything has been called has to be what opens it. Ignoring the
  // failure is deliberate: there is no exception channel here, and a document
  // with no frame has nothing to hear anyway.
  EnsureBound();
}

ExecutionContext* DomicileHost::GetExecutionContext() const {
  return window_.Get();
}

void DomicileHost::Trace(Visitor* visitor) const {
  visitor->Trace(displays_);
  visitor->Trace(windows_);
  visitor->Trace(held_);
  visitor->Trace(file_search_);
  visitor->Trace(file_preview_);
  visitor->Trace(app_search_);
  visitor->Trace(last_clipboard_);
  visitor->Trace(last_tray_items_);
  visitor->Trace(last_notifications_);
  visitor->Trace(last_extensions_);
  visitor->Trace(last_audio_);
  visitor->Trace(last_battery_);
  visitor->Trace(last_idle_);
  visitor->Trace(last_locked_);
  visitor->Trace(last_theme_);
  visitor->Trace(last_windows_theme_);
  visitor->Trace(last_modifiers_);
  visitor->Trace(window_);
  visitor->Trace(channel_);
  visitor->Trace(client_receiver_);
  visitor->Trace(tray_);
  visitor->Trace(tray_receiver_);
  visitor->Trace(resize_listener_);
  visitor->Trace(key_listener_);
  visitor->Trace(density_query_);
  visitor->Trace(density_listener_);
  EventTarget::Trace(visitor);
}

}  // namespace blink
