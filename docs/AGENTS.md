# Agents

Agents such as Claude Code drive the desktop through `domicile mcp`
([CLI.md](CLI.md#domicile-mcp)). The user decides what each one may reach,
sees it in the bar the whole time it's in, and can stop it.

## For users

1. Add the server to the agent: `claude mcp add domicile -- domicile mcp`.
2. The first time the agent uses a tool, Domicile asks: **Let Claude Code use
   your desktop?**
   - **Entire desktop**: every window, plus your pointer and keyboard.
   - **Only these windows**: the windows you check. The agent reads and drives
     them through their accessibility trees and their own screenshots, and
     never moves your pointer or types elsewhere. Private browser windows are
     never offered.
   - Cancel, or a minute without an answer, refuses it.
3. While it's in, a violet pill with its name sits in the bar. Click it to see
   what it can reach and what it did last, and **Stop** to end it.
4. An agent you cancel or stop is refused from then on. Its next session asks
   again.

Agents are refused while the desktop is locked.

## Design

```
agent ── MCP (stdio) ── domicile mcp ── domicile agent <name> ── control socket
                             │                                        │
                             │ every tool call is checked             supervisor
                             │ against the grant                      │ (agent_lending)
                             ▼                                        ▼
                        domicile <verb>                  compositor: system call `agent`
                                                          │ portal queue: `agent` dialog
                                                          │ capturing: `agent` session
                                                          ▼
                                                        shell (PortalDialogs, bar)
```

- **The desk holds the grant; `domicile mcp` enforces it.** `domicile mcp`
  runs `domicile agent <name>` on its first tool call and holds it for as long
  as it serves. That connection is the grant: while it's open the session is
  listed, and when the shell stops the session the compositor hangs up, which
  `domicile mcp` reads as stopped. Each tool call checks the grant first
  (`mcp::guarded`). With only some windows, `list_windows` lists only those,
  `close_window` and the browser and app tools take only those, and every tool
  that reaches the whole desk is refused.
- **It guards consent, not a hostile process.** A local agent that can run
  `domicile` itself can bypass `domicile mcp`; so can anything else running as
  the user. The ask is about the user knowing and choosing what an agent they
  connect may touch. A remote agent reaches the desk only through
  `domicile mcp`, which holds the grant.
- **The ask is a portal dialog, though no portal asks.** The `agent` system
  call (`SystemRequest::Agent`) puts a `PortalKind::Agent` dialog in the queue
  every portal uses, so a shell draws it with its other dialogs and a shell
  that doesn't know it refuses it like any unknown kind. The answer is
  `PortalAnswer::Agent { reach }`; the compositor drops windows the dialog
  didn't offer (`portals::agent`).
- **A session is a capturing session.** `CapturingKind::Agent` carries the
  agent's name, its reach and its last five actions, newest first. The shell
  stops it with the stop every session takes. `domicile mcp` reports each
  action as one line, such as `Clicked in Notes`, never what it typed.
- **The name is the agent's own word.** It comes from the client's
  `initialize` (`clientInfo.title`, else `name`) and is not checked.
- **Private windows are never offered.** The dialog lists every window but
  private browser windows, and the engine refuses DevTools on them anyway.

## Shells

`<PortalDialogs />` draws the dialog (`AgentDialog`) and lists a running agent
in its capturing indicator. A shell that shows agents itself, as Manganese's
bar does, passes `omitAgents`. The SDK parses the dialog as `PortalKind.Agent`,
answers it with `PortalAnswer.Agent(reach)`, and lists a session as
`CapturingKind.Agent`.
