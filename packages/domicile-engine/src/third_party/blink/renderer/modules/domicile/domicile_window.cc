// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_window.h"

namespace blink {

DomicileWindow::DomicileWindow(const DomicileWindowState& state)
    : state_(state) {}

DomicileWindow::~DomicileWindow() = default;

void DomicileWindow::Trace(Visitor* visitor) const {
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
