// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "third_party/blink/renderer/modules/domicile/window_domicile.h"

#include "third_party/blink/renderer/core/frame/local_dom_window.h"
#include "third_party/blink/renderer/core/frame/navigator.h"
#include "third_party/blink/renderer/modules/domicile/navigator_domicile.h"

namespace blink {

// static
DomicileHost* WindowDomicile::domicile(LocalDOMWindow& window) {
  // `navigator()` builds the Navigator on first reach and never answers null,
  // so there is nothing to guard here: the one absence this attribute reports
  // is a Navigator with no window, which NavigatorDomicile already answers for.
  return NavigatorDomicile::domicile(*window.navigator());
}

}  // namespace blink
