// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_HOST_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_HOST_H_

#include <optional>

#include "components/domicile/mojom/control_channel.mojom-blink.h"
#include "components/domicile/mojom/extension_tray.mojom-blink.h"
#include "third_party/blink/renderer/modules/domicile/domicile_chord.h"
#include "third_party/blink/renderer/bindings/core/v8/script_promise.h"
#include "third_party/blink/renderer/bindings/core/v8/script_promise_resolver.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_theme.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_tray_action.h"
#include "third_party/blink/renderer/core/dom/events/event_target.h"
#include "third_party/blink/renderer/modules/domicile/domicile_event_names.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"
#include "third_party/blink/renderer/platform/bindings/script_state.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/mojo/heap_mojo_receiver.h"
#include "third_party/blink/renderer/platform/mojo/heap_mojo_remote.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

// Forward-declared rather than included, which is how every other Blink header
// carrying one does it -- see xr_input_sources_change_event.h. `frozen_array.h`
// is included by the .cc.
template <typename IDLType>
class FrozenArray;

class DomicileDisplay;
class DomicileShortcut;
class DomicileClipboardEntry;
class DomicileTrayItem;
class DomicileNotification;
class DomicileExtension;
class DomicileAudioDevice;
class DomicileAudioStream;
class DomicileAudioCard;
class DomicileWindow;
class DomicileAppSearch;
class DomicileFilePreview;
class DomicileFileSearch;
struct DomicileWindowState;
class LocalDOMWindow;
class MediaQueryList;
class MediaQueryListListener;
class NativeEventListener;

// The desktop a shell is handed — the shell's control channel to the compositor.
//
// The page calls methods and listens for events; the wire protocol lives in the
// browser process. That is the whole design decision, and its cost is that
// adding a message is an engine release rather than a TypeScript edit. What it
// buys is that a page cannot construct a malformed message, and -- much more
// importantly -- that the channel is reachable by origin rather than by
// whoever can open a TCP connection to a loopback port.
//
// See docs/architecture/ENGINE-FORK.md, "The page is served over a TCP port,
// and it should not be".
class MODULES_EXPORT DomicileHost final
    : public EventTarget,
      public domicile::mojom::blink::ControlChannelClient,
      public domicile::mojom::blink::ExtensionTrayClient {
  DEFINE_WRAPPERTYPEINFO();

 public:
  explicit DomicileHost(LocalDOMWindow&);
  ~DomicileHost() override;

  // Run a command on the machine running the desktop.
  //
  // Throws on an empty argv. The browser refuses it too -- this check is a
  // better error message, not the enforcement.
  void spawn(ScriptState*, const Vector<String>& command, ExceptionState&);
  // Ask what in the home matches `query`; the promise settles with the answer.
  // Names no path -- see the IDL, where that is written down as a property
  // rather than a convenience.
  ScriptPromise<DomicileFileSearch> searchFiles(ScriptState*,
                                                const String& query,
                                                ExceptionState&);
  // Ask what is in one file; the promise settles with the answer. The path is
  // one searchFiles() named -- see the IDL for why that is the whole of what
  // it may name.
  ScriptPromise<DomicileFilePreview> previewFile(ScriptState*,
                                                 const String& path,
                                                 ExceptionState&);
  // Ask which installed applications match `query`; the promise settles with
  // the answer.
  ScriptPromise<DomicileAppSearch> searchApps(ScriptState*,
                                              const String& query,
                                              ExceptionState&);
  void copyClipboardEntry(ScriptState*, uint32_t entry, ExceptionState&);
  void activateTrayItem(ScriptState*,
                        const String& id,
                        V8DomicileTrayAction action,
                        ExceptionState&);
  void dismissNotifications(ScriptState*,
                            const Vector<uint32_t>& ids,
                            ExceptionState&);
  void invokeNotificationAction(ScriptState*,
                                uint32_t id,
                                const String& action,
                                ExceptionState&);
  void focusApp(ScriptState*, const String& app_id, ExceptionState&);
  void focusChrome(ScriptState*, ExceptionState&);
  void warpPointer(ScriptState*, double x, double y, ExceptionState&);
  void closeApp(ScriptState*, const String& app_id, ExceptionState&);
  void resizeApp(ScriptState*,
                 const String& app_id,
                 double width,
                 double height,
                 ExceptionState&);
  // Draw the desktop the other way round. Answered with `themechanged` to
  // every chrome on the desk, this one included.
  //
  // BY VALUE, which is what the bindings hand an enumeration: `blink_v8_bridge`
  // gives an IDL enum `ref_fmt` and `const_ref_fmt` of `{}` alike, and
  // `V8DomicileTheme` is a trivially copyable wrapper over an `enum class`. A
  // `const&` compiles -- the generated call site passes an lvalue -- and is a
  // pointer where the value is smaller. `DomicileWindowState` holds its
  // `V8DomicileCursorShape` the same way.
  void setTheme(ScriptState*, V8DomicileTheme theme, ExceptionState&);
  // Offer a passphrase at a locked desk. Answered with `lockedchanged` to
  // every chrome, and only when the desk actually opened -- see the IDL,
  // where that is written down as the property it is rather than as a
  // convenience.
  void unlock(ScriptState*, const String& passphrase, ExceptionState&);
  // Lock the desk now. Answered with `lockedchanged` to every chrome.
  void lock(ScriptState*, ExceptionState&);
  // Set the backlight. Answered with `brightnesschanged` to every chrome.
  void setBrightness(ScriptState*, double level, ExceptionState&);
  // The mixer's requests. Each is answered with `audiochanged` to every
  // chrome.
  void setAudioVolume(ScriptState*,
                      const String& id,
                      double volume,
                      ExceptionState&);
  void setAudioMuted(ScriptState*,
                     const String& id,
                     bool muted,
                     ExceptionState&);
  void setDefaultAudioDevice(ScriptState*, const String& id, ExceptionState&);
  void moveAudioStream(ScriptState*,
                       const String& id,
                       const String& device,
                       ExceptionState&);
  void setAudioPort(ScriptState*,
                    const String& id,
                    const String& port,
                    ExceptionState&);
  void setAudioProfile(ScriptState*,
                       const String& card,
                       const String& profile,
                       ExceptionState&);
  // A lease on these ids' meters. Answered with `audiolevels`.
  void watchAudioLevels(ScriptState*,
                        const Vector<String>& ids,
                        ExceptionState&);
  // This page's old frame is held for `theme`: the desk's windows may turn.
  // Answered with `windowsthemechanged` once they have.
  void themeCaptured(ScriptState*, V8DomicileTheme theme, ExceptionState&);
  void grabShortcut(ScriptState*,
                    const DomicileShortcut* shortcut,
                    ExceptionState&);
  // The chord, `Meta+Shift+l`, resolved here against the keys the compositor
  // says the keyboard has, and again whenever it says so anew.
  void grabShortcut(ScriptState*, const String& chord, ExceptionState&);
  void activateExtension(ScriptState*, const String& id, ExceptionState&);
  void key(ScriptState*,
           const String& app_id,
           uint32_t keycode,
           bool pressed,
           ExceptionState&);
  void pointerMotion(ScriptState*,
                     const String& app_id,
                     double x,
                     double y,
                     ExceptionState&);
  void pointerLeave(ScriptState*, const String& app_id, ExceptionState&);
  void pointerButton(ScriptState*,
                     const String& app_id,
                     uint32_t button,
                     bool pressed,
                     ExceptionState&);
  void pointerAxis(ScriptState*,
                   const String& app_id,
                   double dx,
                   double dy,
                   int32_t v120_x,
                   int32_t v120_y,
                   ExceptionState&);

  // Blink's DEFINE_ATTRIBUTE_EVENT_LISTENER, keyed on the fork's own names
  // rather than event_type_names: see domicile_event_names.h for why.
#define DOMICILE_ATTRIBUTE_EVENT_LISTENER(lower_name, function_name) \
  EventListener* on##lower_name() {                                  \
    return GetAttributeEventListener(                                \
        domicile_event_names::function_name());                      \
  }                                                                  \
  void setOn##lower_name(EventListener* listener) {                  \
    SetAttributeEventListener(domicile_event_names::function_name(), \
                              listener);                             \
  }
  DOMICILE_EVENT_NAMES(DOMICILE_ATTRIBUTE_EVENT_LISTENER)
#undef DOMICILE_ATTRIBUTE_EVENT_LISTENER

  // The desktop's screens, or null until the compositor has described them.
  // An empty array is a desktop with no screens, which is a different answer.
  const FrozenArray<DomicileDisplay>* displays() const {
    return displays_.Get();
  }

  // The screen's brightness, or null until the compositor has said one.
  std::optional<double> brightness() const { return brightness_; }

  // Every client window, in the order they appeared. Not const: reading it
  // binds the channel, which is what has the compositor announce them.
  const FrozenArray<DomicileWindow>& windows();

  // The window holding the keyboard, or a null String when the page holds it.
  const String& focusedWindow() const { return focused_window_; }

  // The desk's state: what the compositor last said, null until it has said
  // anything. See the IDL.
  const FrozenArray<DomicileClipboardEntry>* clipboard() const;
  const FrozenArray<DomicileTrayItem>* tray() const;
  const FrozenArray<DomicileNotification>* notifications() const;
  const FrozenArray<DomicileExtension>* extensions() const;
  const FrozenArray<DomicileAudioDevice>* audioOutputs() const;
  const FrozenArray<DomicileAudioDevice>* audioInputs() const;
  const FrozenArray<DomicileAudioStream>* audioPlayback() const;
  const FrozenArray<DomicileAudioStream>* audioRecording() const;
  const FrozenArray<DomicileAudioCard>* audioCards() const;
  std::optional<double> batteryCharge() const;
  std::optional<bool> batteryCharging() const;
  std::optional<bool> idle() const;
  std::optional<bool> locked() const;
  std::optional<V8DomicileTheme> theme() const;
  std::optional<V8DomicileTheme> windowsTheme() const;
  std::optional<bool> altKey() const;
  std::optional<bool> ctrlKey() const;
  std::optional<bool> shiftKey() const;
  std::optional<bool> metaKey() const;

  // EventTarget:
  const AtomicString& InterfaceName() const override;
  ExecutionContext* GetExecutionContext() const override;

  // domicile::mojom::blink::ControlChannelClient:
  void AppTitled(const String& app_id, const String& title) override;
  void AudioLevels(
      Vector<domicile::mojom::blink::AudioLevelPtr> levels) override;
  void AppAppeared(const String& app_id,
                   const String& title,
                   bool has_size,
                   double width,
                   double height) override;
  void AppResized(const String& app_id, double width, double height) override;
  void AppMinSize(const String& app_id, double width, double height) override;
  void AppMaxSize(const String& app_id, double width, double height) override;
  void PopupPlaced(const String& app_id,
                   const String& parent_app_id,
                   double x,
                   double y,
                   double width,
                   double height,
                   bool grab) override;
  void AppClosed(const String& app_id) override;
  void AppCursor(const String& app_id,
                 domicile::mojom::blink::CursorShape cursor) override;
  void ShortcutPressed(domicile::mojom::blink::ShortcutPtr shortcut) override;
  void Modifiers(bool alt, bool ctrl, bool shift, bool meta) override;
  void Files(const String& query,
             const Vector<String>& files,
             uint32_t matched,
             bool indexing) override;
  void FilePreview(const String& path,
                   const String& kind,
                   const String& text,
                   const Vector<String>& entries,
                   const String& title,
                   const String& artist,
                   const String& album,
                   double duration,
                   const String& cover) override;
  void Apps(const String& query,
            Vector<domicile::mojom::blink::DesktopEntryPtr> apps,
            Vector<domicile::mojom::blink::BookmarkPtr> bookmarks) override;
  void Battery(double charge, bool charging) override;
  void Brightness(double level) override;
  void Clipboard(
      Vector<domicile::mojom::blink::ClipboardEntryPtr> entries) override;
  void Tray(Vector<domicile::mojom::blink::TrayItemPtr> items) override;
  void Notifications(
      Vector<domicile::mojom::blink::NotificationPtr> items) override;
  void ThemeChanged(domicile::mojom::blink::Theme theme) override;
  void Idle(bool idle) override;
  void Locked(bool locked) override;
  void WindowsThemeChanged(domicile::mojom::blink::Theme theme) override;
  void ShellConfig(const String& config) override;
  void Audio(Vector<domicile::mojom::blink::AudioDevicePtr> outputs,
             Vector<domicile::mojom::blink::AudioDevicePtr> inputs,
             Vector<domicile::mojom::blink::AudioStreamPtr> playback,
             Vector<domicile::mojom::blink::AudioStreamPtr> recording,
             Vector<domicile::mojom::blink::AudioCardPtr> cards) override;
  void FocusChanged(const String& app_id) override;
  void FocusRequested(const String& app_id) override;
  void OpenUrl(const String& url) override;
  void Displays(
      Vector<domicile::mojom::blink::DisplayInfoPtr> displays) override;

  // domicile::mojom::blink::ExtensionTrayClient:
  void ExtensionsChanged(
      Vector<domicile::mojom::blink::TrayExtensionPtr> extensions) override;

  void Trace(Visitor*) const override;

 protected:
  // EventTarget, and protected there. Listening is using: see `EnsureBound`.
  void AddedEventListener(const AtomicString& event_type,
                          RegisteredEventListener&) override;

 private:
  // Bound lazily, on first use rather than at construction: a shell that never
  // touches the channel should not make the browser reach for the compositor's
  // socket, and the browser holds that connection open once asked.
  //
  // USE INCLUDES LISTENING, which is why `AddedEventListener` is overridden.
  // The inbound direction opens here -- `SetClient` hands the compositor its
  // way back in the same breath -- so a shell that only reacts, registering
  // `onwindowschanged` and calling nothing, would never bind and never hear a
  // word, with nothing anywhere to say why. That is most of a shell: the
  // windows a desktop shows are announced, not asked for.
  //
  // It also means nothing arrives before the page is ready for it. A socket
  // the page has not opened cannot deliver, and neither can this, so the
  // already-running clients the compositor announces on connect are announced
  // to a page that is listening by construction.
  bool EnsureBound();

  // The window `app_id` names, added at the end if the compositor has not
  // mentioned it before.
  DomicileWindowState& WindowNamed(const String& app_id);
  // Rebuild `windows_` from `window_states_` and say so with
  // `windowschanged`.
  void WindowsChanged();

  // A moment rather than a state -- `openurl`, `focusrequested`, `shortcut` --
  // has no attribute to read late, so one that arrives before anything
  // listens for it is held, and handed to the first listener of its type.
  // Without this an address `domicile open-url` sent while the shell was still
  // loading would be gone. At most `kMostHeld`: a page that never listens
  // must not grow without bound.
  void DispatchOrHold(Event& event);
  void DeliverHeld(const AtomicString& event_type);

  // The desktop's size and density, told to the compositor by the engine
  // rather than by the page: the shell's window IS the desktop, the compositor
  // never sees it, and a shell that forgot to say would leave every client laid
  // out against the compositor's startup placeholder. Sent as the channel
  // binds and again on every `resize` and every change of `devicePixelRatio`.
  // See docs/architecture/WINDOW-DOMICILE.md.
  void ReportGeometry();
  void ReportDesktopSize();
  // Re-arms `density_query_` at the new ratio: a `(resolution: Ndppx)` query
  // matches one ratio, so hearing the next change means asking a new one.
  void ReportDevicePixelRatio();

  // The chords grabbed by name: resolve each against `keys_`, and grab every
  // one whose key moved. See grabShortcut(const String&).
  void ResolveChords();
  // The chord grabbed by name that `press` is, or empty.
  String ChordFor(const DomicilePress& press) const;
  // A key went down on the page. One that is a chord grabbed by name is the
  // desktop's: taken from the page and dispatched as `shortcut`, the same as
  // the browser process does for one pressed in a `<webview>`.
  void PageKeyDown(Event* event);
  bool Ready(ExceptionState&);
  bool ReadyForApp(const String& app_id, ExceptionState&);

  Member<LocalDOMWindow> window_;
  // Replaced wholesale on every description rather than edited: the compositor
  // sends the whole desktop each time, and a `FrozenArray` is frozen.
  Member<FrozenArray<DomicileDisplay>> displays_;
  // What the compositor has said about each window, in the order they
  // appeared, and the frozen copy `windows` hands out.
  Vector<DomicileWindowState> window_states_;
  Member<FrozenArray<DomicileWindow>> windows_;
  String focused_window_;
  // Moments that arrived before anything listened -- see DispatchOrHold.
  HeapVector<Member<Event>> held_;
  // The one outstanding ask of each kind, and what it asked: an answer settles
  // it only if it answers that. A newer ask rejects the older -- see
  // searchFiles() in the IDL.
  Member<ScriptPromiseResolver<DomicileFileSearch>> file_search_;
  String file_search_query_;
  Member<ScriptPromiseResolver<DomicileFilePreview>> file_preview_;
  String file_preview_path_;
  Member<ScriptPromiseResolver<DomicileAppSearch>> app_search_;
  String app_search_query_;
  // The desk's state, which its attributes read: what the compositor -- or,
  // for `extensions_`, the browser -- last said, and null or nullopt until it
  // has said anything. Each list replaced wholesale, for `displays_`'s reason.
  Member<FrozenArray<DomicileClipboardEntry>> clipboard_;
  Member<FrozenArray<DomicileTrayItem>> tray_items_;
  Member<FrozenArray<DomicileNotification>> notifications_;
  Member<FrozenArray<DomicileExtension>> extensions_;
  Member<FrozenArray<DomicileAudioDevice>> audio_outputs_;
  Member<FrozenArray<DomicileAudioDevice>> audio_inputs_;
  Member<FrozenArray<DomicileAudioStream>> audio_playback_;
  Member<FrozenArray<DomicileAudioStream>> audio_recording_;
  Member<FrozenArray<DomicileAudioCard>> audio_cards_;
  std::optional<double> battery_charge_;
  std::optional<bool> battery_charging_;
  std::optional<bool> idle_;
  std::optional<bool> locked_;
  std::optional<V8DomicileTheme> theme_;
  std::optional<V8DomicileTheme> windows_theme_;
  std::optional<bool> alt_key_;
  std::optional<bool> ctrl_key_;
  std::optional<bool> shift_key_;
  std::optional<bool> meta_key_;
  std::optional<double> brightness_;
  HeapMojoRemote<domicile::mojom::blink::ControlChannel> channel_;
  HeapMojoReceiver<domicile::mojom::blink::ControlChannelClient, DomicileHost>
      client_receiver_;
  // The extensions' tray: the browser's own pipe, not the compositor's, bound
  // beside the channel -- see EnsureBound.
  HeapMojoRemote<domicile::mojom::blink::ExtensionTray> tray_;
  HeapMojoReceiver<domicile::mojom::blink::ExtensionTrayClient, DomicileHost>
      tray_receiver_;
  // What ReportGeometry listens with: `resize` on the window, and a query for
  // the ratio last reported. Null until the channel binds.
  Member<NativeEventListener> resize_listener_;
  Member<MediaQueryList> density_query_;
  Member<MediaQueryListListener> density_listener_;

  // A chord grabbed by name, and the press it is on the last keyboard heard.
  struct GrabbedChord {
    String written;
    DomicileWrittenChord chord;
    std::optional<DomicilePress> press;
  };
  Vector<GrabbedChord> chords_;
  // Every keysym the keyboard types and the evdev key it is on, from the last
  // `shell_config`; nullopt until the first.
  std::optional<HashMap<String, uint32_t>> keys_;
  // `keydown` on the window, once a chord is grabbed by name.
  Member<NativeEventListener> key_listener_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_HOST_H_
