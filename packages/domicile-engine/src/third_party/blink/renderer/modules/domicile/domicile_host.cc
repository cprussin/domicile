// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_host.h"

#include <cmath>
#include <optional>
#include <string_view>
#include <utility>

#include "base/check.h"
#include "base/functional/callback.h"
#include "base/functional/callback_helpers.h"
#include "ui/events/keycodes/dom/keycode_converter.h"
#include "components/domicile/common/cursor_shape.h"
#include "components/domicile/common/display_transform.h"
#include "components/domicile/common/theme.h"
#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/bindings/core/v8/script_value.h"
#include "third_party/blink/renderer/bindings/core/v8/v8_binding_for_core.h"
#include "third_party/blink/renderer/bindings/core/v8/v8_object_builder.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_app_search.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_cursor_shape.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_file_preview.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_file_search.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_shortcut.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_theme.h"
#include "third_party/blink/renderer/core/css/media_query_list.h"
#include "third_party/blink/renderer/core/css/media_query_list_listener.h"
#include "third_party/blink/renderer/core/dom/document.h"
#include "third_party/blink/renderer/core/dom/element_traversal.h"
#include "third_party/blink/renderer/core/dom/events/custom_event.h"
#include "third_party/blink/renderer/core/dom/events/native_event_listener.h"
#include "third_party/blink/renderer/core/events/keyboard_event.h"
#include "third_party/blink/renderer/core/inspector/console_message.h"
#include "third_party/blink/renderer/core/event_target_names.h"
#include "third_party/blink/renderer/core/event_type_names.h"
#include "third_party/blink/renderer/core/frame/local_dom_window.h"
#include "third_party/blink/renderer/core/frame/local_frame.h"
#include "third_party/blink/renderer/core/html_names.h"
#include "third_party/blink/renderer/modules/domicile/domicile_app_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_audio_card.h"
#include "third_party/blink/renderer/modules/domicile/domicile_audio_choice.h"
#include "third_party/blink/renderer/modules/domicile/domicile_audio_device.h"
#include "third_party/blink/renderer/modules/domicile/domicile_audio_levels_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_audio_stream.h"
#include "third_party/blink/renderer/modules/domicile/domicile_bookmark.h"
#include "third_party/blink/renderer/modules/domicile/domicile_clipboard_entry.h"
#include "third_party/blink/renderer/modules/domicile/domicile_desktop_entry.h"
#include "third_party/blink/renderer/modules/domicile/domicile_display.h"
#include "third_party/blink/renderer/modules/domicile/domicile_extension.h"
#include "third_party/blink/renderer/modules/domicile/domicile_notification.h"
#include "third_party/blink/renderer/modules/domicile/domicile_notification_action.h"
#include "third_party/blink/renderer/modules/domicile/domicile_open_url_event.h"
#include "third_party/blink/renderer/modules/domicile/domicile_shortcut_event.h"
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

// The Linux evdev key a key event is on, from its DOM `code`; zero or less
// for a code with none.
int EvdevOf(const KeyboardEvent& key) {
  return ui::KeycodeConverter::DomCodeToEvdevCode(
      ui::KeycodeConverter::CodeStringToDomCode(key.code().Utf8()));
}

// The events an <app> dispatches for the shell to answer. Not the desktop's
// own names -- they are dispatched on the element, not on the desktop, and the
// SDK names them -- so they are not in domicile_event_names.h.
constexpr char kFocusRequested[] = "domicile-focus-requested";
constexpr char kFocusReleaseRequested[] = "domicile-focus-release-requested";

// Something happened on the page: a key went down or up, a press, a blur.
class PageHeard final : public NativeEventListener {
 public:
  explicit PageHeard(base::RepeatingCallback<void(Event*)> heard)
      : heard_(std::move(heard)) {}

  void Invoke(ExecutionContext*, Event* event) override { heard_.Run(event); }

 private:
  const base::RepeatingCallback<void(Event*)> heard_;
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
    : AppInputClient(window),
      window_(&window),
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
  return clipboard_.Get();
}

const FrozenArray<DomicileTrayItem>* DomicileHost::tray() const {
  return tray_items_.Get();
}

const FrozenArray<DomicileNotification>* DomicileHost::notifications() const {
  return notifications_.Get();
}

const FrozenArray<DomicileExtension>* DomicileHost::extensions() const {
  return extensions_.Get();
}

const FrozenArray<DomicileAudioDevice>* DomicileHost::audioOutputs() const {
  return audio_outputs_.Get();
}

const FrozenArray<DomicileAudioDevice>* DomicileHost::audioInputs() const {
  return audio_inputs_.Get();
}

const FrozenArray<DomicileAudioStream>* DomicileHost::audioPlayback() const {
  return audio_playback_.Get();
}

const FrozenArray<DomicileAudioStream>* DomicileHost::audioRecording() const {
  return audio_recording_.Get();
}

const FrozenArray<DomicileAudioCard>* DomicileHost::audioCards() const {
  return audio_cards_.Get();
}

std::optional<double> DomicileHost::batteryCharge() const {
  return battery_charge_;
}

std::optional<bool> DomicileHost::batteryCharging() const {
  return battery_charging_;
}

std::optional<bool> DomicileHost::idle() const {
  return idle_;
}

std::optional<bool> DomicileHost::locked() const {
  return locked_;
}

std::optional<V8DomicileTheme> DomicileHost::theme() const {
  return theme_;
}

std::optional<V8DomicileTheme> DomicileHost::windowsTheme() const {
  return windows_theme_;
}

std::optional<bool> DomicileHost::altKey() const {
  return alt_key_;
}

std::optional<bool> DomicileHost::ctrlKey() const {
  return ctrl_key_;
}

std::optional<bool> DomicileHost::shiftKey() const {
  return shift_key_;
}

std::optional<bool> DomicileHost::metaKey() const {
  return meta_key_;
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

// Both halves: the compositor's seat, and where this page's keys go. A shell
// used to need the SDK's `focusApp` for the second, and one that called this
// alone moved the seat and went on typing into the page.
void DomicileHost::focusApp(ScriptState*, const String& app_id,
                            ExceptionState& exception_state) {
  if (ReadyForApp(app_id, exception_state)) {
    FocusAppKeyboard(app_id);
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
// this page hears about it is `lockedchanged` like every other chrome on the
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
// `lockedchanged` every chrome on the desk hears.
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
    FocusChromeKeyboard();
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
    key_listener_ = MakeGarbageCollected<PageHeard>(BindRepeating(
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
  const int evdev = EvdevOf(*key);
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
      press.ctrl, press.shift, press.meta));
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

// THE PAGE'S INPUT, which was the SDK's `registerElements`. An <app> maps a
// pointer over it and hands it here; the keys are the document's, and are
// heard on it. On the document and in the bubbling phase, as the SDK's were,
// so a shell that stops a key or a press before it gets there has taken it.
void DomicileHost::RouteInput() {
  ProvideTo(*window_, static_cast<AppInputClient*>(this));
  Document& document = *window_->document();
  const auto listen = [this](EventTarget& target, const AtomicString& type,
                             void (DomicileHost::*heard)(Event*)) {
    auto* listener = MakeGarbageCollected<PageHeard>(
        BindRepeating(heard, WrapWeakPersistent(this)));
    target.addEventListener(type, listener);
    input_listeners_.push_back(listener);
  };
  listen(document, event_type_names::kKeydown, &DomicileHost::ForwardKeyDown);
  listen(document, event_type_names::kKeyup, &DomicileHost::ForwardKeyUp);
  listen(document, event_type_names::kPointerdown,
         &DomicileHost::ReleaseKeyboardOffApp);
  // A page that has lost the keyboard -- or is going away -- is never told a
  // key came up. `pagehide` as well as `blur` because a reload is not a focus
  // change, and it is the event a navigation fires reliably.
  listen(*window_, event_type_names::kBlur, &DomicileHost::ReleaseHeldKeys);
  listen(*window_, event_type_names::kPagehide,
         &DomicileHost::ReleaseHeldKeys);
  listen(document, event_type_names::kFocusin, &DomicileHost::ReleaseIntoGuest);
  // AND A WHEEL LISTENER THAT DOES NOTHING, because listening is what brings a
  // wheel to this thread at all: with none on the page the compositor thread
  // scrolls by itself and no `wheel` is dispatched, so an <app> would never
  // see one. Passive -- the platform makes a document's so -- so it holds up
  // no scroll. The pointer needs no such thing: the `pointerdown` above is a
  // pointer listener, which is what Blink asks before it dispatches any.
  auto* wheel = MakeGarbageCollected<PageHeard>(
      base::DoNothingAs<void(Event*)>());
  document.addEventListener(event_type_names::kWheel, wheel);
  input_listeners_.push_back(wheel);
}

void DomicileHost::AppPressed(HTMLAppElement& app, const String& app_id) {
  // A popup's window rather than the popup: a click on a menu is a click on
  // the window it belongs to.
  const String window = WindowOf(app_id);
  if (Ask(app, kFocusRequested, window, std::nullopt)) {
    FocusAppKeyboard(window);
  }
}

void DomicileHost::AppPointerMotion(const String& app_id,
                                    const gfx::PointF& point,
                                    const gfx::SizeF& size) {
  // Into what the client drew, which the compositor said; one that has drawn
  // nothing yet is mapped through its own box, 1:1.
  double x = point.x();
  double y = point.y();
  for (const DomicileWindowState& state : window_states_) {
    if (state.app_id == app_id && state.width && state.height) {
      x = *state.width > 0 ? x * *state.width / size.width() : x;
      y = *state.height > 0 ? y * *state.height / size.height() : y;
      break;
    }
  }
  if (EnsureBound()) {
    channel_->PointerMotion(app_id, x, y);
  }
}

void DomicileHost::AppPointerButton(const String& app_id,
                                    uint32_t button,
                                    bool pressed) {
  if (EnsureBound()) {
    channel_->PointerButton(app_id, button, pressed);
  }
}

void DomicileHost::AppPointerLeave(const String& app_id) {
  if (EnsureBound()) {
    channel_->PointerLeave(app_id);
  }
}

void DomicileHost::AppPointerAxis(const String& app_id,
                                  double dx,
                                  double dy,
                                  int32_t v120_x,
                                  int32_t v120_y) {
  if (EnsureBound()) {
    channel_->PointerAxis(app_id, dx, dy, v120_x, v120_y);
  }
}

void DomicileHost::FocusAppKeyboard(const String& app_id) {
  keyboard_app_ = app_id;
  if (EnsureBound()) {
    channel_->FocusApp(app_id);
  }
}

void DomicileHost::FocusChromeKeyboard() {
  keyboard_app_ = String();
  if (EnsureBound()) {
    channel_->FocusChrome();
  }
}

// The window the keyboard was routed to can leave the page without anything
// saying so: a shell takes an <app> down when its client closes. Left alone,
// every key after a window closes is taken from the page and sent to a client
// that is gone. The compositor's seat still points at it too, so the page says
// the keyboard is its own again, which is where a closed client's keyboard
// goes. One walk of the <app>s per key, against a socket write on the same
// path.
String DomicileHost::KeyboardTarget() {
  if (!keyboard_app_.IsNull() && !AppElement(keyboard_app_)) {
    FocusChromeKeyboard();
  }
  return keyboard_app_;
}

void DomicileHost::ForwardKeyDown(Event* event) {
  auto* key = DynamicTo<KeyboardEvent>(event);
  if (!key) {
    return;
  }
  const String app_id = KeyboardTarget();
  const int evdev = EvdevOf(*key);
  if (evdev <= 0) {
    return;
  }
  const uint32_t keycode = static_cast<uint32_t>(evdev);
  // A chord grabbed by name arrives taken -- PageKeyDown heard it first and
  // answered it as `shortcut` -- and so does a key the page took. Its release
  // is not the client's either.
  if (event->defaultPrevented()) {
    taken_keys_.insert(keycode);
    return;
  }
  if (app_id.IsNull()) {
    return;
  }
  event->preventDefault();
  // The browser repeats a held key; Wayland does not. A client repeats from
  // `wl_keyboard.repeat_info` itself, so forwarding these as presses would
  // give it two sources of repeat, drawn as one character over and over.
  if (key->repeat()) {
    return;
  }
  held_keys_.Set(keycode, app_id);
  if (EnsureBound()) {
    channel_->Key(app_id, keycode, true);
  }
}

// Every release the page hears, not only those for a press it forwarded: a
// key held while the page reloads comes up on a page that never saw it go
// down, and kept back it stays down in the seat under every later key. The
// compositor drops a release for a key its seat does not hold, which is what
// makes sending them all safe. Except a key whose press was taken.
void DomicileHost::ForwardKeyUp(Event* event) {
  auto* key = DynamicTo<KeyboardEvent>(event);
  if (!key) {
    return;
  }
  const int evdev = EvdevOf(*key);
  if (evdev <= 0) {
    return;
  }
  const uint32_t keycode = static_cast<uint32_t>(evdev);
  if (taken_keys_.Contains(keycode)) {
    taken_keys_.erase(keycode);
    return;
  }
  const String held = held_keys_.Take(keycode);
  if (!held.IsNull()) {
    event->preventDefault();
  }
  // The window the press was sent for where this page sent it, and otherwise
  // the one that has the keyboard. The compositor reads neither -- it injects
  // the key into the seat, whose focus delivers it -- and an empty one is a
  // desk where no window has it.
  String app_id = held;
  if (app_id.IsNull()) {
    app_id = keyboard_app_.IsNull() ? g_empty_string : keyboard_app_;
  }
  if (EnsureBound()) {
    channel_->Key(app_id, keycode, false);
  }
}

void DomicileHost::ReleaseHeldKeys(Event*) {
  if (EnsureBound()) {
    for (const auto& held : held_keys_) {
      channel_->Key(held.value, held.key, false);
    }
  }
  held_keys_.clear();
}

// A key released while a <webview>'s guest has the focus comes up on the site
// and never in this document, so what this page holds is let go as the guest
// takes it. Without that, Super held through the chord that focuses a browser
// window stays down in the seat, and every window afterward takes each key as
// a Super chord.
void DomicileHost::ReleaseIntoGuest(Event* event) {
  auto* element =
      DynamicTo<Element>(event->target() ? event->target()->ToNode() : nullptr);
  if (element && element->localName() == "webview") {
    ReleaseHeldKeys(event);
  }
}

// A press off every <app> landed on the page, and nothing in it says whether
// that was the desktop behind the windows or the title bar of the window that
// has the keyboard. So the shell is asked, and the keyboard comes back to the
// page unless it says no. A window whose <app> has left the page is not asked
// and does not keep it.
void DomicileHost::ReleaseKeyboardOffApp(Event* event) {
  Element* pressed =
      DynamicTo<Element>(event->target() ? event->target()->ToNode() : nullptr);
  if (keyboard_app_.IsNull() ||
      (pressed && Traversal<HTMLAppElement>::FirstAncestorOrSelf(*pressed))) {
    return;
  }
  const String app_id = keyboard_app_;
  HTMLAppElement* app = AppElement(app_id);
  if (!app || Ask(*app, kFocusReleaseRequested, app_id, pressed)) {
    FocusChromeKeyboard();
  }
}

String DomicileHost::WindowOf(const String& app_id) const {
  for (const DomicileWindowState& state : window_states_) {
    if (state.app_id == app_id) {
      return state.parent.empty() ? app_id : WindowOf(state.parent);
    }
  }
  return app_id;
}

HTMLAppElement* DomicileHost::AppElement(const String& app_id) const {
  Document* document = window_ ? window_->document() : nullptr;
  if (!document) {
    return nullptr;
  }
  for (HTMLAppElement& app :
       Traversal<HTMLAppElement>::DescendantsOf(*document)) {
    if (app.FastGetAttribute(html_names::kAppIdAttr) == app_id) {
      return &app;
    }
  }
  return nullptr;
}

// A CustomEvent, as the SDK dispatched it, so a shell reads the same `detail`.
// Untrusted, as that one was: the page is being asked, not told.
bool DomicileHost::Ask(Element& target,
                       const char* type,
                       const String& app_id,
                       std::optional<Element*> pressed) {
  LocalFrame* frame = window_ ? window_->GetFrame() : nullptr;
  ScriptState* script_state =
      frame ? ToScriptStateForMainWorld(frame) : nullptr;
  // A document with no script has no shell to say no.
  if (!script_state) {
    return true;
  }
  ScriptState::Scope scope(script_state);
  V8ObjectBuilder detail(script_state);
  detail.AddString("appId", app_id);
  if (pressed && *pressed) {
    detail.Add("pressed", *pressed);
  } else if (pressed) {
    detail.AddV8Value("pressed", v8::Undefined(script_state->GetIsolate()));
  }
  CustomEvent* event = CustomEvent::Create();
  event->initCustomEvent(
      script_state, AtomicString(type), /*bubbles=*/true, /*cancelable=*/true,
      ScriptValue(script_state->GetIsolate(), detail.V8Object()));
  return target.DispatchEvent(*event) == DispatchEventResult::kNotCanceled;
}

void DomicileHost::AppAppeared(const String& app_id, const String& title,
                               bool has_size, double width, double height) {
  DomicileWindowState& state = WindowNamed(app_id);
  state.title = title;
  if (has_size) {
    state.width = width;
    state.height = height;
  }
  WindowsChanged();
}

void DomicileHost::AppResized(const String& app_id, double width,
                              double height) {
  DomicileWindowState& state = WindowNamed(app_id);
  state.width = width;
  state.height = height;
  WindowsChanged();
}

void DomicileHost::AppMinSize(const String& app_id, double width,
                              double height) {
  DomicileWindowState& state = WindowNamed(app_id);
  state.min_width = width;
  state.min_height = height;
  WindowsChanged();
}

void DomicileHost::AppMaxSize(const String& app_id, double width,
                              double height) {
  DomicileWindowState& state = WindowNamed(app_id);
  state.max_width = width;
  state.max_height = height;
  WindowsChanged();
}

void DomicileHost::PopupPlaced(const String& app_id,
                               const String& parent_app_id,
                               double x,
                               double y,
                               double width,
                               double height,
                               bool grab) {
  DomicileWindowState& state = WindowNamed(app_id);
  state.parent = parent_app_id;
  state.x = x;
  state.y = y;
  state.width = width;
  state.height = height;
  state.grab = grab;
  WindowsChanged();
}

void DomicileHost::AppClosed(const String& app_id) {
  EraseIf(window_states_, [&](const DomicileWindowState& state) {
    return state.app_id == app_id;
  });
  WindowsChanged();
}

void DomicileHost::AppCursor(const String& app_id,
                             domicile::mojom::blink::CursorShape cursor) {
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
}

void DomicileHost::ShortcutPressed(
    domicile::mojom::blink::ShortcutPtr shortcut) {
  const DomicilePress press{shortcut->keycode, shortcut->alt, shortcut->ctrl,
                            shortcut->shift, shortcut->meta};
  DispatchOrHold(*MakeGarbageCollected<DomicileShortcutEvent>(
      domicile_event_names::Shortcut(), ChordFor(press), shortcut->keycode,
      shortcut->alt, shortcut->ctrl, shortcut->shift, shortcut->meta));
}

void DomicileHost::Modifiers(bool alt, bool ctrl, bool shift, bool meta) {
  alt_key_ = alt;
  ctrl_key_ = ctrl;
  shift_key_ = shift;
  meta_key_ = meta;
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
  extensions_ =
      MakeGarbageCollected<FrozenArray<DomicileExtension>>(std::move(tray));
  DispatchEvent(*Event::Create(domicile_event_names::Extensionschanged()));
}

// An answer to searchFiles(): it settles the promise that asked it.
void DomicileHost::Files(const String& query,
                         const Vector<String>& files,
                         uint32_t matched,
                         bool indexing) {
  auto* answer = DomicileFileSearch::Create();
  answer->setFiles(files);
  answer->setMatched(matched);
  answer->setIndexing(indexing);
  Settle(file_search_, file_search_query_, query, answer);
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
                               const String& cover) {
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
}

// An answer, like Files. The entries are built here rather than carried as
// parallel arrays because what a launcher draws and runs is an entry -- see
// `domicile_desktop_entry.h`.
void DomicileHost::Apps(const String& query,
                        Vector<domicile::mojom::blink::DesktopEntryPtr> apps,
                        Vector<domicile::mojom::blink::BookmarkPtr> bookmarks) {
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
}

// Pushed, so there is no ask for this to be the answer to. The compositor
// polls the kernel's files and sends one of these when the reading moves far
// enough to draw -- see `domicile_host::battery`, which is also where the
// reason a page cannot read this for itself is written down.
void DomicileHost::Battery(double charge, bool charging) {
  battery_charge_ = charge;
  battery_charging_ = charging;
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
    Vector<domicile::mojom::blink::ClipboardEntryPtr> entries) {
  HeapVector<Member<DomicileClipboardEntry>> history;
  history.reserve(entries.size());
  for (const auto& entry : entries) {
    history.push_back(MakeGarbageCollected<DomicileClipboardEntry>(
        entry->id, entry->preview));
  }
  clipboard_ = MakeGarbageCollected<FrozenArray<DomicileClipboardEntry>>(
      std::move(history));
  DispatchEvent(*Event::Create(domicile_event_names::Clipboardchanged()));
}

// Pushed, like Clipboard: an icon is the session bus's, which the compositor
// hears without anybody asking.
void DomicileHost::Tray(Vector<domicile::mojom::blink::TrayItemPtr> items) {
  HeapVector<Member<DomicileTrayItem>> tray;
  tray.reserve(items.size());
  for (const auto& item : items) {
    tray.push_back(MakeGarbageCollected<DomicileTrayItem>(item->id, item->title,
                                                          item->icon));
  }
  tray_items_ =
      MakeGarbageCollected<FrozenArray<DomicileTrayItem>>(std::move(tray));
  DispatchEvent(*Event::Create(domicile_event_names::Traychanged()));
}

// Pushed, like Tray: a notification is a call on the session bus, which the
// compositor hears without anybody asking.
void DomicileHost::Notifications(
    Vector<domicile::mojom::blink::NotificationPtr> items) {
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
  notifications_ = MakeGarbageCollected<FrozenArray<DomicileNotification>>(
      std::move(notifications));
  DispatchEvent(*Event::Create(domicile_event_names::Notificationschanged()));
}

// Pushed, like Battery, and the one pushed message this page can cause:
// `setTheme` above is answered with it, to every chrome on the desk rather
// than to the one that called. Through the wire name, for `AppCursor`'s
// reason and with `AppCursor`'s unreachable CHECK.
void DomicileHost::ThemeChanged(domicile::mojom::blink::Theme theme) {
  theme_ = PageTheme(theme);
  DispatchEvent(*Event::Create(domicile_event_names::Themechanged()));
}

// The same closed set as `theme`, about the desk's windows rather than its
// chrome.
void DomicileHost::WindowsThemeChanged(domicile::mojom::blink::Theme theme) {
  windows_theme_ = PageTheme(theme);
  DispatchEvent(*Event::Create(domicile_event_names::Windowsthemechanged()));
}

// Pushed like Battery, and a state rather than an edge -- the compositor
// decides the edge, because lighting a connector is a modeset and a dark desk
// must not ask for one per tick, and then sends where the desk stands so that
// a page which has only just loaded is not left drawing a desktop somebody is
// at. See `crate::idle` in the compositor.
void DomicileHost::Idle(bool idle) {
  idle_ = idle;
  DispatchEvent(*Event::Create(domicile_event_names::Idlechanged()));
}

// Pushed like Idle above, and a state for its reason with the stakes the other
// way up: the edge a reloaded page missed is the one that would have raised its
// lock screen, and the compositor holding the lock is what makes a reload
// something the desk survives rather than something that opens it. See
// `crate::lock` in the compositor.
void DomicileHost::Locked(bool locked) {
  locked_ = locked;
  DispatchEvent(*Event::Create(domicile_event_names::Lockedchanged()));
}

// Pushed like ThemeChanged. Only its keys are read, for the chords grabbed by
// name; nothing of it reaches the page. See ControlChannelClient::ShellConfig.
void DomicileHost::ShellConfig(const String& config) {
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
    Vector<domicile::mojom::blink::AudioCardPtr> cards) {
  audio_outputs_ = MakeGarbageCollected<FrozenArray<DomicileAudioDevice>>(
      AudioDevices(outputs));
  audio_inputs_ = MakeGarbageCollected<FrozenArray<DomicileAudioDevice>>(
      AudioDevices(inputs));
  audio_playback_ = MakeGarbageCollected<FrozenArray<DomicileAudioStream>>(
      AudioStreams(playback));
  audio_recording_ = MakeGarbageCollected<FrozenArray<DomicileAudioStream>>(
      AudioStreams(recording));
  audio_cards_ =
      MakeGarbageCollected<FrozenArray<DomicileAudioCard>>(AudioCards(cards));
  DispatchEvent(*Event::Create(domicile_event_names::Audiochanged()));
}

// Pushed while anything is metered, as rows like every list here.
void DomicileHost::AudioLevels(
    Vector<domicile::mojom::blink::AudioLevelPtr> levels) {
  HeapVector<Member<DomicileAudioLevel>> made;
  made.reserve(levels.size());
  for (const auto& level : levels) {
    made.push_back(
        MakeGarbageCollected<DomicileAudioLevel>(level->id, level->peak));
  }
  DispatchEvent(*MakeGarbageCollected<DomicileAudioLevelsEvent>(
      domicile_event_names::Audiolevels(), std::move(made)));
}

void DomicileHost::FocusChanged(const String& app_id) {
  // Empty is the shell's page holding the keyboard, which `focusedWindow`
  // says as null.
  //
  // Dispatched for every word the compositor says about the keyboard, not
  // only when it moves: the first is also the end of the windows replayed to
  // a channel that has just bound, and a shell that waits for it is how it
  // tells a window opened now from one that was already running.
  focused_window_ = app_id.empty() ? String() : app_id;
  // The keys this page forwards go where the compositor says the keyboard is,
  // and not only where the page last asked: it moves the keyboard on its own
  // too, and a page that heard only its own asks went on forwarding every key
  // to a client that no longer had it.
  keyboard_app_ = focused_window_;
  DispatchEvent(*Event::Create(domicile_event_names::Focusedwindowchanged()));
}

// Deliberately not `focusedWindow`: that says where the keyboard went and this
// says a client would like it. A page that conflated them would grant every
// request by drawing it as granted.
void DomicileHost::FocusRequested(const String& app_id) {
  DispatchOrHold(*MakeGarbageCollected<DomicileAppEvent>(
      domicile_event_names::Focusrequested(), app_id));
}

void DomicileHost::OpenUrl(const String& url) {
  DispatchOrHold(*MakeGarbageCollected<DomicileOpenUrlEvent>(
      domicile_event_names::Openurl(), url));
}

void DomicileHost::AppTitled(const String& app_id, const String& title) {
  WindowNamed(app_id).title = title;
  WindowsChanged();
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
  visitor->Trace(clipboard_);
  visitor->Trace(tray_items_);
  visitor->Trace(notifications_);
  visitor->Trace(extensions_);
  visitor->Trace(audio_outputs_);
  visitor->Trace(audio_inputs_);
  visitor->Trace(audio_playback_);
  visitor->Trace(audio_recording_);
  visitor->Trace(audio_cards_);
  visitor->Trace(window_);
  visitor->Trace(channel_);
  visitor->Trace(client_receiver_);
  visitor->Trace(tray_);
  visitor->Trace(tray_receiver_);
  visitor->Trace(resize_listener_);
  visitor->Trace(key_listener_);
  visitor->Trace(density_query_);
  visitor->Trace(density_listener_);
  visitor->Trace(input_listeners_);
  EventTarget::Trace(visitor);
  AppInputClient::Trace(visitor);
}

}  // namespace blink
