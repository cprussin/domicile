// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_AGENT_INPUT_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_AGENT_INPUT_H_

namespace domicile {

// Agent seats in the browser's pages. See docs/architecture/AGENT-SEATS.md in
// the Domicile repository.
//
// The compositor drives each agent's own pointer and keyboard. Over a native
// window it sends the events down the agent's Wayland seat; over the shell's
// page it sends them here (the control channel's `agent_input`). This finds
// the page under the desk point by the same hit test a person's pointer gets,
// and hands that page's widget the event straight, without the shell seeing
// it and without moving the user's pointer or focused page:
//
// - A point where the shell itself is, or any page that is not a browser
//   window, is refused: agents act on the shell by ref.
// - So is a window the user is in (their keyboard, or their pointer over it),
//   and a window the compositor bars (taken from this agent, or another
//   agent's).
// - A press focuses the page it lands in for the agent, beside the user's
//   focused page, and the agent's keys go to that page's focused frame.
// - While a button is down, the page pressed keeps the agent's pointer. A drag
//   the page starts is the agent's, carried over the pages under its pointer,
//   never handed to the platform, which would grab the user's pointer.
// - Each event is answered with the browser window it reached
//   (`agent_input_reached`), which the compositor tells the shell the seat
//   holds.
// - The person wins: the user's pointer over a window an agent points in, or
//   their press or key into a window an agent types in, says so
//   (`person_in_agents_window`), and the compositor takes it from the agent.
//
// Starts it: the control channel's sink, content's drag taker, and the watch
// on the user's input. Once, from StartDesk, on the UI thread.
void StartAgentInput();

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_AGENT_INPUT_H_
