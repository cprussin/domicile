// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/navigator_domicile.h"

#include "third_party/blink/renderer/core/execution_context/execution_context.h"
#include "third_party/blink/renderer/core/frame/local_dom_window.h"

namespace blink {

// static
const char NavigatorDomicile::kSupplementName[] = "NavigatorDomicile";

NavigatorDomicile::NavigatorDomicile(Navigator& navigator)
    : Supplement<Navigator>(navigator) {}

// static
NavigatorDomicile& NavigatorDomicile::From(Navigator& navigator) {
  NavigatorDomicile* supplement =
      Supplement<Navigator>::From<NavigatorDomicile>(navigator);
  if (!supplement) {
    supplement = MakeGarbageCollected<NavigatorDomicile>(navigator);
    ProvideTo(navigator, supplement);
  }
  return *supplement;
}

// static
DomicileHost* NavigatorDomicile::domicile(Navigator& navigator) {
  LocalDOMWindow* window = navigator.DomWindow();
  if (!window) {
    return nullptr;
  }
  NavigatorDomicile& self = From(navigator);
  if (!self.host_) {
    self.host_ = MakeGarbageCollected<DomicileHost>(*window);
  }
  return self.host_.Get();
}

void NavigatorDomicile::Trace(Visitor* visitor) const {
  visitor->Trace(host_);
  Supplement<Navigator>::Trace(visitor);
}

}  // namespace blink
