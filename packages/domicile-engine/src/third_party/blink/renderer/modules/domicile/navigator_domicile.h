// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_NAVIGATOR_DOMICILE_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_NAVIGATOR_DOMICILE_H_

#include "third_party/blink/renderer/core/frame/navigator.h"
#include "third_party/blink/renderer/modules/domicile/domicile_host.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/supplementable.h"

namespace blink {

// Hangs navigator.domicile off Navigator, the way every other navigator.*
// extension does -- and hands the host out once per document.
//
// ONCE, BECAUSE A SHELL IS HANDED IT RATHER THAN FINDING IT. The document
// Domicile writes (ShellURLLoaderFactory::ShellDocument) reads this first and
// calls the shell's `Shell(root, domicile)` with it; every read after that
// answers null. So the desktop is the shell's to keep however it likes -- a
// React context, a module's own variable -- and nothing on the page reaches
// for a global the shell did not hand it. A reload is a new document, and
// hands it out again.
class MODULES_EXPORT NavigatorDomicile final
    : public GarbageCollected<NavigatorDomicile>,
      public Supplement<Navigator> {
 public:
  static const char kSupplementName[];

  explicit NavigatorDomicile(Navigator&);

  static DomicileHost* domicile(Navigator&);

  void Trace(Visitor*) const override;

 private:
  static NavigatorDomicile& From(Navigator&);

  Member<DomicileHost> host_;
  // Whether this document has been handed the host already.
  bool handed_ = false;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_NAVIGATOR_DOMICILE_H_
