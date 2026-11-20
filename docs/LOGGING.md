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

- **Compositor:** `RUST_LOG`, such as `RUST_LOG=debug`.
- **Engine:** `DOMICILE_ENGINE_ARGS`, such as `DOMICILE_ENGINE_ARGS='--log-level=0'`
  or `--v=1`. See [Running a desktop](RUNNING-A-DESKTOP.md).
