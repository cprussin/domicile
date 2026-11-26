// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/agent_clipboards.h"

#include "ui/base/clipboard/clipboard.h"
#include "ui/base/clipboard/clipboard_non_backed.h"

namespace domicile {

AgentClipboards::AgentClipboards() = default;

AgentClipboards::~AgentClipboards() = default;

ui::Clipboard* AgentClipboards::For(const std::string& seat) {
  std::unique_ptr<ui::Clipboard>& clipboard = clipboards_[seat];
  if (!clipboard) {
    clipboard = ui::ClipboardNonBacked::CreateDomicileSeparate();
  }
  return clipboard.get();
}

ui::Clipboard* AgentClipboards::ForPage(
    const std::optional<std::string>& seat) {
  return seat.has_value() ? For(*seat) : nullptr;
}

void AgentClipboards::Gone(const std::string& seat) {
  clipboards_.erase(seat);
}

}  // namespace domicile
