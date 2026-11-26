// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_AGENT_CLIPBOARDS_H_
#define COMPONENTS_DOMICILE_BROWSER_AGENT_CLIPBOARDS_H_

#include <memory>
#include <optional>
#include <string>

#include "base/containers/flat_map.h"

namespace ui {
class Clipboard;
}

namespace domicile {

// Agents' own clipboards in the browser, one per agent seat. A page an agent's
// input last drove copies to and pastes from its agent's, never the desktop's,
// which the compositor puts on the user's seat. See
// docs/architecture/AGENT-SEATS.md.
//
// In memory only: the compositor never sees them, so nothing else pastes them.
class AgentClipboards {
 public:
  AgentClipboards();

  AgentClipboards(const AgentClipboards&) = delete;
  AgentClipboards& operator=(const AgentClipboards&) = delete;

  ~AgentClipboards();

  // Agent seat `seat`'s clipboard ("agent-3"), made on first use.
  ui::Clipboard* For(const std::string& seat);

  // The clipboard for a page an agent seat last drove, or null for the
  // desktop's when no agent seat did.
  ui::Clipboard* ForPage(const std::optional<std::string>& seat);

  // Agent seat `seat`'s session ended: its copies go with it.
  void Gone(const std::string& seat);

 private:
  base::flat_map<std::string, std::unique_ptr<ui::Clipboard>> clipboards_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_AGENT_CLIPBOARDS_H_
