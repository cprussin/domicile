// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_HOST_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_HOST_H_

#include "components/domicile/mojom/control_channel.mojom-blink.h"
#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/core/dom/events/event_target.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/exception_state.h"
#include "third_party/blink/renderer/platform/bindings/script_state.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/mojo/heap_mojo_receiver.h"
#include "third_party/blink/renderer/platform/mojo/heap_mojo_remote.h"
#include "third_party/blink/renderer/platform/wtf/text/wtf_string.h"

namespace blink {

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
  void focusApp(ScriptState*, const String& app_id, ExceptionState&);
  void focusChrome(ScriptState*, ExceptionState&);
  void closeApp(ScriptState*, const String& app_id, ExceptionState&);
  void resizeApp(ScriptState*,
                 const String& app_id,
                 double width,
                 double height,
                 ExceptionState&);
  void setDesktopSize(ScriptState*, double width, double height, ExceptionState&);
  void setDevicePixelRatio(ScriptState*, double ratio, ExceptionState&);
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

  DEFINE_ATTRIBUTE_EVENT_LISTENER(apptitled, kApptitled)
  DEFINE_ATTRIBUTE_EVENT_LISTENER(appappeared, kAppappeared)
  DEFINE_ATTRIBUTE_EVENT_LISTENER(appresized, kAppresized)
  DEFINE_ATTRIBUTE_EVENT_LISTENER(appclosed, kAppclosed)
  DEFINE_ATTRIBUTE_EVENT_LISTENER(appcursor, kAppcursor)
  DEFINE_ATTRIBUTE_EVENT_LISTENER(shortcut, kShortcut)
  DEFINE_ATTRIBUTE_EVENT_LISTENER(modifiers, kModifiers)
  DEFINE_ATTRIBUTE_EVENT_LISTENER(focuschanged, kFocuschanged)
  DEFINE_ATTRIBUTE_EVENT_LISTENER(displayschanged, kDisplayschanged)

  // The desktop's screens, empty until the compositor has described them.
  const FrozenArray<DomicileDisplay>& displays() const {
    return *displays_.Get();
  }

  // EventTarget:
  const AtomicString& InterfaceName() const override;
  ExecutionContext* GetExecutionContext() const override;

  // domicile::mojom::blink::ControlChannelClient:
  void AppTitled(const String& app_id, const String& title) override;
  void AppAppeared(const String& app_id,
                   const String& title,
                   bool has_size,
                   double width,
                   double height) override;
  void AppResized(const String& app_id, double width, double height) override;
  void AppClosed(const String& app_id) override;
  void AppCursor(const String& app_id, const String& cursor) override;
  void ShortcutPressed(domicile::mojom::blink::ShortcutPtr shortcut) override;
  void Modifiers(bool alt, bool ctrl, bool shift, bool meta) override;
  void FocusChanged(const String& app_id) override;
  void Displays(
      WTF::Vector<domicile::mojom::blink::DisplayPtr> displays) override;

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
