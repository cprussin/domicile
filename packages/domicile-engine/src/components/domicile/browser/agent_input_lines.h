// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_BROWSER_AGENT_INPUT_LINES_H_
#define COMPONENTS_DOMICILE_BROWSER_AGENT_INPUT_LINES_H_

#include <stdint.h>

#include <optional>
#include <string>
#include <vector>

#include "base/values.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/vector2d_f.h"

namespace domicile {

// The control channel's agent seat messages, which are the browser's and never
// the page's: an agent seat's input for the browser's pages
// (`agent_input`), what it reached (`agent_input_reached`), and the user's own
// input reaching a window an agent holds (`person_in_agents_window`). See
// chrome/browser/domicile/domicile_agent_input.h, and
// docs/architecture/AGENT-SEATS.md in the Domicile repository.
//
// Their own file beside the channel so a test can read and write them with no
// socket.

// One event of an agent seat's input, `agent_input`.
struct AgentPageInput {
  enum class Kind {
    // The pointer moved to `at`, on the desk in the shell page's CSS pixels.
    kPointer,
    // Evdev button `code`.
    kButton,
    // By `scroll` logical pixels, down and right positive.
    kScroll,
    // Evdev key `code`, into the window the seat's keyboard is in.
    kKey,
    // The seat's keyboard goes to browser window `window`.
    kFocus,
    // The seat's pointer left the pages, for a native window.
    kLeave,
    // The seat's keyboard left the pages.
    kBlur,
    // Every button and key it holds in the pages comes up.
    kLetGo,
    // The seat is gone.
    kGone,
  };

  // Every page's channel hears each one; the first of each serial counts.
  uint64_t serial = 0;
  // `agent-<session>`.
  std::string seat;
  Kind kind = Kind::kLeave;
  gfx::PointF at;
  gfx::Vector2dF scroll;
  uint32_t code = 0;
  bool pressed = false;
  std::string window;
  // Browser windows the event must not reach: taken from the agent by the
  // user, or held by another agent.
  std::vector<std::string> barred;
  // Not answered.
  bool quiet = false;
};

// nullopt for a message this engine cannot read.
std::optional<AgentPageInput> ReadAgentInput(const base::DictValue& message);

// `agent_input_reached`: the event of `serial` reached browser window
// `window`, or was refused for `refused`.
base::DictValue AgentInputReachedMessage(uint64_t serial,
                                         const std::optional<std::string>& window,
                                         const std::optional<std::string>& refused);

// `person_in_agents_window`: the user's input reached `window`, which `seat`
// holds; with their keyboard when `keyboard`.
base::DictValue PersonInAgentsWindowMessage(const std::string& seat,
                                            const std::string& window,
                                            bool keyboard);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_AGENT_INPUT_LINES_H_
