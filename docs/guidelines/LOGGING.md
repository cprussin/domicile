# Logging

How code in this repo logs. [docs/LOGGING.md](/docs/LOGGING.md) is the
user-facing side: where lines go and how to turn them up.

## The rules

- **Quiet by default.** A desktop at its starting levels says errors and
  nothing else. Anything below an error is opt-in through
  `domicile set-log-level`.
- **Every line has a level and a subsystem.** Write through the part's
  leveled logger (below), never to stderr or the console directly.
- **Pick the level by what it says**, as the table under
  [Levels](/docs/LOGGING.md#levels) defines:

  | Level | For |
  |---|---|
  | `error` | Something broke that the user would notice. |
  | `warn` | Something unexpected that the desktop got past. |
  | `info` | What changed: a window opened, the relay answered. |
  | `debug` | Why: each request handled, and what was decided. Timings go here. |
  | `trace` | Everything: each event, each frame. |

- **Pick the subsystem the line is about**, from `domicile_protocol::Subsystem`:
  an agent's tool call is `agents`, even when the code is in the launcher.
  A new area gets a new subsystem, not a line in a neighbor's.
- **Never a secret or what was typed.** No passwords, tokens or key presses'
  keys. Logs get exported and shared.
- **Build a costly line only when it shows.** Gate it on the logger's
  `showing`/`enabled` check rather than formatting and dropping it.

## Which logger

| Code | Logger |
|---|---|
| The compositor | `tracing` (`error!`, `debug!`, …). Its module maps to a subsystem in `log_levels.rs`; a new module joins `MODULES`. |
| The launcher (`domicile` running the desktop) | `domicile_launch::launcher_log` (`error`, `warn`, `info`, `debug`; `showing`). |
| A process the desktop starts that `set-log-level` doesn't reach, such as `domicile mcp --relay` | `domicile_launch::desk_log::say(subsystem, level, …)`: asks the desktop's levels for each line below an error. |
| The engine | `LOG(ERROR)` for errors, `VLOG(n)` below. A new file joins its subsystem's patterns in `engine_log_levels.rs`. Engine logging stays in `.cc` files. |
| A shell, or the SDK | `logger(subsystem)` from `@domicile-desktop/sdk/logger`. |

## What may write to stderr or the console bare

Only output for whoever ran something:

- a command's own messages and errors (`domicile <verb>`, `domicile-xdg-open`),
- a process's last words before it exits, before any logger is up,
- test tools and fixtures, whose tests read what they say.

## How it's checked

- **Rust:** clippy's `print_stderr` is denied workspace-wide. A file or
  function that is one of the cases above says so with
  `#[expect(clippy::print_stderr, reason = "…")]` (or `#![allow]` for a whole
  command's file). Tests may print (`clippy.toml`).
- **TypeScript:** Biome's `noConsole` is an error. A
  `// biome-ignore lint/suspicious/noConsole: <why>` must name one of the
  cases above; shell code logs through `logger`.
- Review: a new `expect`, `allow` or `biome-ignore` for these lints needs its
  reason to be one of the cases above.
