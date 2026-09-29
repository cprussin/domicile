// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_EXTENSIONS_EVENT_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_EXTENSIONS_EVENT_H_

#include "third_party/blink/renderer/bindings/core/v8/frozen_array.h"
#include "third_party/blink/renderer/modules/domicile/domicile_extension.h"
#include "third_party/blink/renderer/modules/event_modules.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/bindings/script_wrappable.h"

namespace blink {

class DomicileExtensionsEventInit;

// The extensions with an action, for the shell's tray.
//
// Pushed, so there is nothing on DomicileHost this answers: the browser sends
// the whole tray when the page binds and again whenever an extension is added,
// removed, or its action changes. See components/domicile/mojom/
// extension_tray.mojom.
class MODULES_EXPORT DomicileExtensionsEvent final : public Event {
  DEFINE_WRAPPERTYPEINFO();

 public:
  static DomicileExtensionsEvent* Create(
      const AtomicString& type,
      const DomicileExtensionsEventInit* initializer);

  DomicileExtensionsEvent(const AtomicString& type,
                          const DomicileExtensionsEventInit* initializer);
  DomicileExtensionsEvent(const AtomicString& type,
                          HeapVector<Member<DomicileExtension>> extensions);
  ~DomicileExtensionsEvent() override;

  const FrozenArray<DomicileExtension>& extensions() const {
    return *extensions_;
  }

  const AtomicString& InterfaceName() const override;
  void Trace(Visitor*) const override;

 private:
  // Frozen because the IDL says so, and never null: both constructors build
  // one, an empty tray included -- which is an answer, a profile with no
  // extension that has an action.
  Member<FrozenArray<DomicileExtension>> extensions_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_EXTENSIONS_EVENT_H_
