# Agents

Claude Code, claude.ai and other AI agents can use your desktop: open apps,
read windows, click and type. You choose what each one can reach, see it in
the bar while it works, and can stop it at any time.

## Claude Code

Add your desktop to Claude Code, in a terminal:

```sh
claude mcp add domicile -- domicile mcp
```

Other agents that run on your computer take the same command, `domicile mcp`.

## claude.ai and ChatGPT

1. Open **Settings**, then **Agents**, and turn on **Connect from the web**.
   In the config file, that's `{ "agents": { "web": true } }`.
2. Copy your desktop's address from there.
3. Add it to the agent:
   - **claude.ai**: add it as a custom connector.
   - **ChatGPT**: turn on **Developer mode** in **Settings › Apps › Advanced
     settings**, then **Create** an app with the address as its MCP server
     URL and OAuth to sign in.
4. Connect. Your desktop asks whether to let it sign in: click **Allow** if
   it shows the same number as your browser.

Each chat asks to use your desktop on its own, and has its own pill.

## Letting an agent in

The first time an agent tries to use your desktop, you're asked whether to
let it in:

- **Entire desktop**: every window, your pointer and your keyboard.
- **Only these windows**: just the windows you check. The agent never moves
  your pointer or types anywhere else.
- **Remember**, with the entire desktop, lets it in from then on without
  asking.

Cancel to keep it out.

## While it works

A violet pill with the agent's name sits in the bar. With several sessions it
shows how many, and reads "Agents" when they're different agents. Click it to
see what each can reach and what it did last, **Change** to give it more or
less, or **Stop** to end it. **Stop all** ends every session.

A window the agent is using has a violet ring with the agent's name, and its
pointer is violet with its name too. The pill's panel lists the windows it's
using now: **Take over** makes one yours.

**Settings › Agents** lists every agent connected or remembered. **Stop** ends
it, **Forget** makes it ask again, and **Sign out** makes an agent on the web
ask to sign in again.

## Good to know

- Agents can't use your desktop while it's locked.
- An agent that does nothing for two minutes leaves your desktop, and its pill
  goes from the bar. If it comes back, it asks again, unless you told it to
  remember.
- An agent has a pointer and keyboard of its own, so it can click and type
  in one app or browser window while you work in another. It never moves
  your pointer or changes what you're typing in.
- An app an agent opens is the agent's from the start, and opens without
  taking you away from what you're doing.
- An agent copies and pastes on a clipboard of its own, so it never
  replaces what you copied, and what it copies stays out of your clipboard
  history.
- An app or browser window you're using is yours. Click or type in one the
  agent is using and it lets go at once. A banner on the window says
  **You're using this window**, the agent's pill turns amber and says
  **Paused**, and the agent waits until you click **Give back**. **Hide** puts
  the banner away and keeps the window yours, and the pill's panel can still
  give it back.
- An agent waits to run shell commands, like switching workspaces, until
  you've left the keyboard and mouse alone for 30 seconds.
- Private browser windows are never offered to an agent.
- An agent you cancel or stop asks again the next time it tries.
- An agent can leave on its own when it's done, and its pill goes away. It
  asks again the next time it needs your desktop.
