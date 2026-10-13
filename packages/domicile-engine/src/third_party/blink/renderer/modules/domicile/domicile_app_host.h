// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_HOST_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_HOST_H_

#include "components/domicile/mojom/app_channel.mojom-blink.h"
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

class LocalDOMWindow;

// The host DomicileApp hands an app module's `main`. See
// docs/architecture/APP-MODULES.md.
class MODULES_EXPORT DomicileAppHost final
    : public EventTarget,
      public domicile::mojom::blink::AppChannelClient {
  DEFINE_WRAPPERTYPEINFO();

 public:
  explicit DomicileAppHost(LocalDOMWindow&);
  ~DomicileAppHost() override;

  void callSystem(ScriptState*,
                  uint32_t id,
                  const String& request,
                  ExceptionState&);

  EventListener* onsystem() {
    return GetAttributeEventListener(domicile_event_names::System());
  }
  void setOnsystem(EventListener* listener) {
    SetAttributeEventListener(domicile_event_names::System(), listener);
  }

  // domicile::mojom::blink::AppChannelClient:
  void System(const String& message) override;

  // EventTarget:
  const AtomicString& InterfaceName() const override;
  ExecutionContext* GetExecutionContext() const override;

  void Trace(Visitor*) const override;

 private:
  // Binds the channel the first time it is needed. False when the window has
  // no frame to ask the browser through.
  bool EnsureBound();

  Member<LocalDOMWindow> window_;
  HeapMojoRemote<domicile::mojom::blink::AppChannel> channel_;
  HeapMojoReceiver<domicile::mojom::blink::AppChannelClient, DomicileAppHost>
      client_receiver_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_HOST_H_
