// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "third_party/blink/renderer/modules/domicile/domicile_browser_window.h"

namespace blink {

DomicileBrowserWindow::DomicileBrowserWindow(
    const String& id,
    const String& url,
    const String& title,
    std::optional<int32_t> popup_window,
    int32_t width,
    int32_t height,
    bool is_private)
    : id_(id),
      url_(url),
      title_(title),
      popup_window_(popup_window),
      width_(width),
      height_(height),
      is_private_(is_private) {}

DomicileBrowserWindow::~DomicileBrowserWindow() = default;

void DomicileBrowserWindow::Trace(Visitor* visitor) const {
  ScriptWrappable::Trace(visitor);
}

}  // namespace blink
