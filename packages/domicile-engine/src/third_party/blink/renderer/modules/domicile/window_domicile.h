// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_WINDOW_DOMICILE_H_
#define THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_WINDOW_DOMICILE_H_

#include "third_party/blink/renderer/modules/modules_export.h"
#include "third_party/blink/renderer/platform/wtf/allocator/allocator.h"

namespace blink {

class DomicileHost;
class LocalDOMWindow;

// window.domicile — the alias a shell actually writes.
//
// It holds nothing. NavigatorDomicile is the supplement that owns the one
// DomicileHost a window gets, and this forwards to it, so the two spellings
// are the same object rather than two channels to the same compositor. A
// supplement here would be a second place for that object to live, which is
// the one thing this must not be.
class MODULES_EXPORT WindowDomicile {
  STATIC_ONLY(WindowDomicile);

 public:
  static DomicileHost* domicile(LocalDOMWindow&);
};

}  // namespace blink

#endif  // THIRD_PARTY_BLINK_RENDERER_MODULES_DOMICILE_WINDOW_DOMICILE_H_
