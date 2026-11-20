# Logs

Where Domicile's logs go and how to read them.

## Where they go

- **A login session, or any desktop whose stderr is the journal:** each line is
  a journal entry with a priority and the name of the part that said it.
- **A terminal, or a file stderr was redirected to:** lines are written as each
  part said them.

Domicile checks `JOURNAL_STREAM` against its own stderr, as systemd documents,
so a desktop started from a terminal inside a systemd service still writes to
the terminal.

## Names

| Name | What |
|---|---|
| `domicile-compositor` | The compositor's tracing, and its panics. |
| `domicile-engine` | The engine and every process it starts. `DOMICILE_PID` is the process that said it. |
| `domicile-shell` | The shell's `console` messages. |

## Reading them

```sh
journalctl --user -b -t domicile-shell           # the shell's console
journalctl --user -b -t domicile-engine -p err   # the engine's errors
journalctl --user -b -t domicile-compositor -f   # follow the compositor
```

Entries carry `CODE_FILE` and `CODE_LINE`: `journalctl --user -b CODE_FILE=dbus/bus.cc`.
The compositor's also carry `TARGET`, the Rust module that said it.

## Priorities

| Priority | Compositor | Engine |
|---|---|---|
| `crit` (2) | | `FATAL` |
| `err` (3) | `ERROR`, and anything on its stderr | `ERROR` |
| `warning` (4) | `WARN` | `WARNING`, and lines without Chromium's prefix |
| `notice` (5) | `INFO` | |
| `info` (6) | `DEBUG` | `INFO` |
| `debug` (7) | `TRACE` | `VERBOSE` |

A line without Chromium's prefix takes the priority of the line before it, so
a stack keeps its error's priority. Before any prefixed line, it is a warning:
a library writing to stderr itself, such as Mesa.

## Levels

Turn the logs up while the desktop runs, for everything or for the subsystems
you are looking into, with `domicile set-log-level`:

```sh
domicile set-log-level trace input      # every input event
domicile set-log-level debug            # everything at debug
domicile set-log-level                  # print the levels set
domicile set-log-level --reset          # back to the starting levels
```

The levels are `error`, `warn`, `info`, `debug` and `trace`. The compositor and
every engine process change at once, and a part that restarts keeps them. They
last until the desktop restarts.

| Subsystem | Covers |
|---|---|
| `input` | Keyboards, pointers, touch, gestures and input methods |
| `displays` | Monitors, modes, scale, color and night light |
| `windows` | App windows, popups, focus and launching apps |
| `rendering` | Frames, buffers, page flips and latency |
| `cast` | Screen sharing, screenshots and casting |
| `portals` | Desktop portals and their dialogs |
| `idle` | Idle, the screen lock and sleep |
| `clipboard` | Copy and paste |
| `notifications` | Notifications and the system tray |
| `electron` | Electron apps on the engine |
| `agents` | Agents that use the desktop |
| `shell` | The shell and its connection to the desktop |
| `session` | Starting, stopping and the login session |

Setting everything leaves Smithay and Chromium's own code at their starting
levels; they log too much to read at `debug`.

To start at other levels:

- **Compositor:** `RUST_LOG`, such as `RUST_LOG=debug`.
- **Engine:** `DOMICILE_ENGINE_ARGS`, such as `DOMICILE_ENGINE_ARGS='--log-level=0'`
  or `--v=1`. See [Running a desktop](RUNNING-A-DESKTOP.md).
