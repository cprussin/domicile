// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_HOST_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_HOST_H_

#include "base/time/time.h"
#include "components/domicile/mojom/control_channel.mojom-blink.h"
#include "third_party/blink/renderer/bindings/modules/v8/v8_domicile_theme.h"
#include "third_party/blink/renderer/core/dom/dom_high_res_time_stamp.h"
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
class LocalDOMWindow;

// navigator.domicile — the shell's control channel to the compositor.
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
      public domicile::mojom::blink::ControlChannelClient {
  DEFINE_WRAPPERTYPEINFO();

 public:
  explicit DomicileHost(LocalDOMWindow&);
  ~DomicileHost() override;

  // Run a command on the machine running the desktop.
  //
  // Throws on an empty argv. The browser refuses it too -- this check is a
  // better error message, not the enforcement.
  void spawn(ScriptState*, const Vector<String>& command, ExceptionState&);
  // Ask what in the home matches `query`; the answer arrives as a `files`
  // event. Names no path -- see the IDL, where that is written down as a
  // property rather than a convenience.
  void searchFiles(ScriptState*, const String& query, ExceptionState&);
  // Ask what is in one file; the answer arrives as a `filepreview` event.
  // The path is one a `files` event named -- see the IDL for why that is the
  // whole of what it may name.
  void previewFile(ScriptState*, const String& path, ExceptionState&);
  void copyClipboardEntry(ScriptState*, uint32_t entry, ExceptionState&);
  void focusApp(ScriptState*, const String& app_id, ExceptionState&);
  void focusChrome(ScriptState*, ExceptionState&);
  void warpPointer(ScriptState*, double x, double y, ExceptionState&);
  void closeApp(ScriptState*, const String& app_id, ExceptionState&);
  void resizeApp(ScriptState*,
                 const String& app_id,
                 double width,
                 double height,
                 ExceptionState&);
  void setDesktopSize(ScriptState*, double width, double height, ExceptionState&);
  void setDevicePixelRatio(ScriptState*, double ratio, ExceptionState&);
  // Draw the desktop the other way round. Answered with a `theme` event to
  // every chrome on the desk, this one included.
  //
  // BY VALUE, which is what the bindings hand an enumeration: `blink_v8_bridge`
  // gives an IDL enum `ref_fmt` and `const_ref_fmt` of `{}` alike, and
  // `V8DomicileTheme` is a trivially copyable wrapper over an `enum class`. A
  // `const&` compiles -- the generated call site passes an lvalue -- and is a
  // pointer where the value is smaller. `DomicileAppCursorEvent`'s ctor takes
  // its `V8DomicileCursorShape` the same way.
  void setTheme(ScriptState*, V8DomicileTheme theme, ExceptionState&);
  // Offer a passphrase at a locked desk. Answered with a `locked` event to
  // every chrome, and only when the desk actually opened -- see the IDL,
  // where that is written down as the property it is rather than as a
  // convenience.
  void unlock(ScriptState*, const String& passphrase, ExceptionState&);
  void grabShortcut(ScriptState*,
                    const DomicileShortcut* shortcut,
                    ExceptionState&);
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

  // EventTarget:
  const AtomicString& InterfaceName() const override;
  ExecutionContext* GetExecutionContext() const override;

  // domicile::mojom::blink::ControlChannelClient:
  //
  // EVERY ONE OF THESE CARRIES AN `arrival`, and it is the browser process's
  // `base::TimeTicks` rather than anything this renderer measured: when that
  // process took the message off the compositor's socket. `Arrival` below is
  // what puts it on the clock the page reads.
  void AppTitled(const String& app_id,
                 const String& title,
                 base::TimeTicks arrival) override;
  void AppAppeared(const String& app_id,
                   const String& title,
                   bool has_size,
                   double width,
                   double height,
                   base::TimeTicks arrival) override;
  void AppResized(const String& app_id,
                  double width,
                  double height,
                  base::TimeTicks arrival) override;
  void AppClosed(const String& app_id, base::TimeTicks arrival) override;
  void AppCursor(const String& app_id,
                 domicile::mojom::blink::CursorShape cursor,
                 base::TimeTicks arrival) override;
  void ShortcutPressed(domicile::mojom::blink::ShortcutPtr shortcut,
                       base::TimeTicks arrival) override;
  void Modifiers(bool alt,
                 bool ctrl,
                 bool shift,
                 bool meta,
                 base::TimeTicks arrival) override;
  void Files(const String& query,
             const Vector<String>& files,
             uint32_t matched,
             bool indexing,
             base::TimeTicks arrival) override;
  void FilePreview(const String& path,
                   const String& kind,
                   const String& text,
                   const Vector<String>& entries,
                   base::TimeTicks arrival) override;
  void Battery(double charge,
               bool charging,
               base::TimeTicks arrival) override;
  void Clipboard(Vector<domicile::mojom::blink::ClipboardEntryPtr> entries,
                 base::TimeTicks arrival) override;
  void ThemeChanged(domicile::mojom::blink::Theme theme,
                    base::TimeTicks arrival) override;
  void Idle(bool idle, base::TimeTicks arrival) override;
  void Locked(bool locked, base::TimeTicks arrival) override;
  void FocusChanged(const String& app_id, base::TimeTicks arrival) override;
  void FocusRequested(const String& app_id, base::TimeTicks arrival) override;
  void Displays(
      Vector<domicile::mojom::blink::DisplayInfoPtr> displays) override;

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
  // `onappappeared` and calling nothing, would never bind and never hear a
  // word, with nothing anywhere to say why. That is most of a shell: the
  // windows a desktop shows are announced, not asked for.
  //
  // It also means nothing arrives before the page is ready for it. A socket
  // the page has not opened cannot deliver, and neither can this, so the
  // already-running clients the compositor announces on connect are announced
  // to a page that is listening by construction.
  bool EnsureBound();
  bool Ready(ExceptionState&);
  bool ReadyForApp(const String& app_id, ExceptionState&);

  // The browser's monotonic stamp, on the clock `performance.now()` and
  // `Event.timeStamp` are on. This document's time origin is what makes the
  // two comparable, which is why it is asked of the window rather than
  // computed from `base::TimeTicks` here.
  DOMHighResTimeStamp Arrival(base::TimeTicks arrival) const;

  Member<LocalDOMWindow> window_;
  // Replaced wholesale on every description rather than edited: the compositor
  // sends the whole desktop each time, and a `FrozenArray` is frozen.
  Member<FrozenArray<DomicileDisplay>> displays_;
  HeapMojoRemote<domicile::mojom::blink::ControlChannel> channel_;
  HeapMojoReceiver<domicile::mojom::blink::ControlChannelClient, DomicileHost>
      client_receiver_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_HOST_H_
