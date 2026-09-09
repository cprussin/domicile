// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_NAVIGATOR_DOMICILE_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_NAVIGATOR_DOMICILE_H_

#include "third_party/blink/renderer/core/frame/navigator.h"
#include "third_party/blink/renderer/modules/domicile/domicile_host.h"
#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/supplementable.h"

namespace blink {

// Hangs navigator.domicile off Navigator, the way every other navigator.*
// extension does.
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
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_NAVIGATOR_DOMICILE_H_
