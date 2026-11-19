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

## claude.ai

1. Open **Settings**, then **Agents**, and turn on **Connect from the web**.
   In the config file, that's `{ "agents": { "web": true } }`.
2. Copy your desktop's address from there, and add it to claude.ai as a
   custom connector.
3. Connect. Your desktop asks whether to let Claude sign in: click **Allow**
   if it shows the same number as your browser.

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

A violet pill with the agent's name sits in the bar. Click it to see what it
can reach and what it did last, **Change** to give it more or less, or
**Stop** to end it.

**Settings › Agents** lists every agent connected or remembered. **Stop** ends
it, **Forget** makes it ask again, and **Sign out** makes an agent on the web
ask to sign in again.

## Good to know

- Agents can't use your desktop while it's locked.
- Private browser windows are never offered to an agent.
- An agent you cancel or stop asks again the next time it tries.
