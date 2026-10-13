// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_H_

#include "third_party/blink/renderer/core/frame/local_dom_window.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/heap/garbage_collected.h"
#include "third_party/blink/renderer/platform/supplementable.h"

namespace blink {

class DomicileAppHost;
class NativeEventListener;

// Runs an app module: the module an app's document names, whose `main` is
// called with the document's body and a DomicileAppHost. DomicileShell's
// counterpart for `domicile://app-<id>/`. See
// docs/architecture/APP-MODULES.md.
class MODULES_EXPORT DomicileApp final : public GarbageCollected<DomicileApp>,
                                         public Supplement<LocalDOMWindow> {
 public:
  static const char kSupplementName[];

  // For every new document's main-world window; does nothing unless the
  // document is an app's. Called from
  // ModulesInitializer::OnClearWindowObjectInMainWorld, before any of the
  // page's script runs.
  static void Install(LocalDOMWindow&);

  explicit DomicileApp(LocalDOMWindow&);

  void Trace(Visitor*) const override;

 private:
  // The document is parsed: find the module it names and run it.
  void Run();

  Member<NativeEventListener> parsed_listener_;
  // The host the app was handed. Null until it runs.
  Member<DomicileAppHost> host_;
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_DOMICILE_APP_H_
