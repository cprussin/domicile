// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHELL_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHELL_H_

#include "third_party/blink/renderer/core/frame/local_dom_window.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/supplementable.h"

namespace blink {

class DomicileHost;
class NativeEventListener;

// Runs the shell: imports the module the shell document names and calls its
// `Shell(root, domicile)` with the body and the desktop.
//
// FROM HERE RATHER THAN FROM A SCRIPT ON THE PAGE, because a script would have
// to find the desktop somewhere, and anywhere a script can find it is a global
// every other script on the page can find too. The desktop is made here and
// passed straight into the call, so the only copy a page holds is the one its
// shell was handed: no `navigator.domicile`, no `window.domicile`.
//
// What runs is still JavaScript -- `import()`, the call, and the report when
// either fails -- because module loading and an exception's message are
// JavaScript's to do well. It is a function this file owns, evaluated without
// binding it to any name and called from here, so the page never sees it.
class MODULES_EXPORT DomicileShell final
    : public GarbageCollected<DomicileShell>,
      public Supplement<LocalDOMWindow> {
 public:
  static const char kSupplementName[];

  // For every new document's main-world window; does nothing unless the
  // document is the shell's own -- `domicile://shell/`. Called from
  // ModulesInitializer::OnClearWindowObjectInMainWorld, before any of the
  // page's script runs.
  static void Install(LocalDOMWindow&);

  explicit DomicileShell(LocalDOMWindow&);

  void Trace(Visitor*) const override;

 private:
  // The document is parsed: find the module it names and run it.
  void Run();

  Member<NativeEventListener> parsed_listener_;
  // The desktop the shell was handed. Null until it runs.
  Member<DomicileHost> desktop_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_SHELL_H_
