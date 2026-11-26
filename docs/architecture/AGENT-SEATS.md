# Agent seats: agents with their own pointer and focus

Each agent session gets a seat of its own: a pointer, a keyboard focus and a
clipboard that never touch the user's. The user and any number of agents work
on the desk at once, each in their own windows. The user wins any window they
both want.

Today the desk has one seat. An agent's `click`, `key` or `focus_window` moves
the user's pointer and focus, so the MCP server refuses them while the user is
at the computer ([AGENTS.md](../AGENTS.md)). The `browser_` and `app_` tools
act by ref and need no seat.

UX mockup: violet agent cursor with its name, a ring and name tag on held
windows, a "You're using this window" banner with Give back, and held
windows listed in the bar pill.

## Design

### Seats

- **The user's seat** is the one `wl_seat` there is today. The engine reads
  its devices, and the shell decides its pointer target and focus.
- **An agent seat** exists for each `domicile agent` grant and ends with it.
  The compositor decides its pointer target and focus. It has no devices: the
  MCP server drives it.
- **A seat holds windows.** An agent seat holds the windows it focused,
  clicked or opened. The user's seat holds every other window.

### One `wl_seat` per client

Clients still see one `wl_seat`. Each client is driven by one seat at a time,
and the compositor sends that seat's events down the client's existing
`wl_pointer` and `wl_keyboard`:

- An agent focusing a window of client C sends C `wl_keyboard.enter` for that
  window. Client D, where the user types, keeps its own `enter`. Each client
  sees a consistent single seat.
- Both seats' windows are `activated`, so both render and take input as
  focused.
- A client the user's seat holds a window of is the user's. The agent can't
  drive another window of it with the seat; it gets "the user is using this
  app" and falls back to refs.

Multiplex over a second `wl_seat` global because Chromium, Electron and
Firefox bind only the first seat, and GTK and Qt treat several as one person.

Smithay's `Seat` sends only to resources bound to its own global, so this
needs a change in the Smithay fork: a seat that borrows another seat's
resources per client.

### What each kind of window gets

| Window | Agent pointer and keys |
|---|---|
| Native Wayland | Agent seat, multiplexed |
| Browser and Electron windows | Agent seat at desk positions, routed compositor → browser (patch 0277); refs through CDP on the window's own page (the `browser_` tools), which moves neither the engine's pointer nor its focus (patch 0276) |
| X11 apps | User's seat only. xwayland-satellite is one client with one X focus, so raw input waits for the user to step away, as today |
| The shell | Refs only (`browser_*` on window `shell`) |

### Browser windows at desk positions

The engine draws every browser window inside the shell's one Wayland
surface, so the compositor can't send a seat's events to a browser window as
it does to a client. It asks the browser instead:

- When an agent's pointer is over the shell's surface and no client window,
  the compositor sends `agent_input` on the control channel: the seat, a
  serial, the input (a pointer move to a desk point, a button, a scroll, a
  key, a focus, or the agent leaving the pages), and the windows the agent
  is barred from (the ones the user took, and the ones other agents hold).
- The browser hit tests the desk point through the shell's views to the
  widget under it. A point that lands in the shell's own page is refused:
  agents act on the shell by ref. A point in a browser window, its views or
  its popups is sent to that widget in its own coordinates, keeping the
  user's focus (patch 0276), and gives that window's page focus of its own
  for the agent's keys.
- Keys go to the page the agent last clicked or focused, as evdev codes
  through the desk's keyboard layout: a key down, the character it types,
  and a key up.
- A drag that starts from an agent's press is carried page to page by the
  browser, never as a platform drag that would move the user's pointer
  (patch 0277).
- The browser answers each ask with `agent_input_reached`: the window it
  reached, or why it refused. The compositor holds the agent's next steps
  until it does, so the agent's tool call answers with the real outcome.
- The person wins here too. The browser watches the user's own pointer and
  keys; a press or key in a window an agent holds is reported with
  `person_in_agents_window`, and the compositor takes it from the agent, as
  it does for a client window.

### Taking over

- The user wins. Their click or key in a window an agent holds moves it to
  the user's seat at once. Any agent's next raw call there, or in its
  popups, fails with "the user took over this window"; refs keep working.
  Focusing another window of the same app only moves the agent's keyboard
  off; it takes nothing.
- A taken window is recorded on the seat it was taken from, so it frees up
  when that agent leaves or the window closes.
- **Give back** returns it. **Take over** in the bar pill's list does the
  same as a click.
- A window an agent opens with `open` or `exec` starts held by the agent and
  does not take the user's focus. The compositor knows it by the process
  that `exec` started, or a descendant of it, and sends the seats before it
  announces the window, so `heldBy` is set when the shell first sees it. A
  shell opens such a window without focusing it. Manganese opens a tiled one
  in a group of its own beside the user's, so it shows, and still focuses one
  that opens on an empty workspace, where the user's keyboard has nowhere
  else to be.
- A URL an agent opens gets a new browser window. The engine lists it with
  `agent` set, so the shell opens it unfocused, and answers its id; `domicile`
  then puts the seat's keyboard in it, as `focus_window` does.

### Clipboard

Each seat has its own clipboard and primary selection. A client sees the
selection of the seat driving it, so an agent's copy never replaces the
user's clipboard. Clipboard managers (data control) and the clipboard
history see only the user's. An agent's selection ends with its session. Copying
between them is explicit: a future `clipboard_read` / `clipboard_write` tool.

### File choosers

A file request an agent's input sets off is the agent's to answer, never a
picker in the user's shell: an `<input type="file">`, a page's
`showOpenFilePicker()` or `showSaveFilePicker()`, or a download's save.

- Each browser window's page remembers who last pressed or keyed in it: an
  agent (DevTools input or its seat) or the person. A request made while an
  agent did is held for the agent; the shell gets no
  `domicile-file-chooser`.
- The agent reads it with `Domicile.fileChooser` and answers it with
  `Domicile.chooseFiles`, the engine's own `devtools` methods. A path that
  isn't there is refused and the request keeps waiting. A newer request
  cancels the older one.
- MCP: an act that leaves the page waiting says so, and
  `browser_choose_files` answers it.

### Shell primitives

Any shell can build the mockup's UX from these:

```ts
domicile.seats.list; // [{ id, name, pointer: {x, y} | undefined, focused, holds, taken }]
window.heldBy; // agent seat id, or undefined for the user's
domicile.seats.takeOver(windowId);
domicile.seats.giveBack(windowId);
```

- `seats.list` lists agent seats only: the user's seat holds every window no
  agent seat does.
- The compositor sends the seats after each run of an agent's input and each
  take or give back, so the shell draws the agent's cursor in the page. The
  hardware cursor plane stays the user's.
- A window the user took (`taken`) stays theirs after their pointer and
  keyboard leave it, until given back.
- The person-wins rule is the compositor's default. Turning it off per window,
  e.g. to let a user watch without interrupting, is not built.

### MCP

- `click`, `move_pointer`, `drag`, `scroll`, `key`, `type_text` and
  `focus_window` use the agent's seat. The 30-second wait remains only for X11
  windows.
- `send_shell` stays on the user's seat behind the wait: shell commands act on
  the user's focus.
- `list_windows` adds `heldBy`.

## Key decisions

- **Multiplex over extra `wl_seat` globals**, because most clients bind only
  the first seat.
- **One seat per client at a time**, because a client has one focus. Two
  windows of one app can't be split between the user and an agent.
- **Person wins**, so an agent can never lock the user out of a window.
- **The browser routes an agent's input in browser windows**, because only
  it knows what is under a desk point inside the shell's surface. The
  compositor still owns the seat, and the browser answers each step.
- **An agent's file chooser skips the shell**, because the agent can't use a
  picker drawn in the user's shell, and the picker would interrupt the user.
- **The shell draws agent cursors**, because there is one hardware cursor
  plane per CRTC and the page already knows where windows are.

## Plan

- [x] Smithay fork: a seat that sends through another seat's resources for a
      client
- [x] compositor: agent seats per grant, per-client routing, person-wins
      takeover (`src/agent_seats.rs`)
- [x] compositor: emulated input tagged with its seat (`ChromeMessage::Emulate`
      names the grant)
- [x] compositor: a selection per seat (Smithay `share_selection_devices`)
- [x] engine: CDP input for browser windows leaves the user's focus (patch
      0275): a press sent to a window's own page target does not focus its
      WebContents, and keys and text go to the frame focused in that page
- [x] protocol and SDK: `seats`, `heldBy`, `takeOver`, `giveBack`
- [x] MCP: raw tools on the agent seat
- [x] MCP: `heldBy` in `list_windows` (`held_by`)
- [x] manganese: agent cursor, ring and name tag, "You're using this
      window" banner with Give back, held windows in the agent pill
- [x] new windows from an agent's `open`/`exec` start held by it
- [x] engine and compositor: an agent seat's pointer, buttons, scrolls,
      keys and drags reach browser windows at desk positions
      (`agent_input`, patch 0277); the shell refuses them; the user's press
      or key takes the window
- [x] manganese: ring, name tag and cursor on browser windows too
- [x] engine and MCP: file choosers an agent's input opens wait for the
      agent (`Domicile.fileChooser`, `Domicile.chooseFiles`,
      `browser_choose_files`)

## Open questions

- **Several people on one desk** (a second mouse and keyboard, a remote
  desktop session as its own seat). Recommend later, on the same seats: it
  needs the engine to tag devices with seats and the shell to route per seat.
- **Agent seat over the shell.** Recommend refs only. Raw input to the page
  would need a second focus in the engine.
