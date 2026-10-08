# The screen lock

A desktop with `lock` configured locks when the screens blank
([IDLE.md](IDLE.md)). While locked, nothing the chrome forwards reaches a
client, and nothing it asks of the desktop is done. What a shell does with
this: [SHELL-IDLE-AND-LOCK.md](SHELL-IDLE-AND-LOCK.md#locking).

## Where the lock is enforced

The compositor enforces the lock because it is the only process that outlives
the page.

- A lock in the page would fall to a reload, an engine restart or devtools.
- A lock at the chrome socket would block the shell's own keys, so nobody could
  type a passphrase.
- The page keeps all its keys while locked so it can draw the lock screen.

The compositor checks each request in `handle_client_request`, and each
connection request in `answer_on_the_connection`, against
`crate::lock::refused`. That `match` is the source of truth. It has no
wildcard, so a new request does not compile until someone decides how a locked
desktop treats it.

| Category | Examples | Effect |
|---|---|---|
| Input | `Key`, pointer motion, buttons, axis, leave; the same from EIS clients (`crate::eis`) | Dropped (`debug` log) |
| Commands | `CloseApp`, `Spawn`, `CopyClipboardEntry`, tray, notifications | Refused (`warn` log) |
| Reads on the connection | `SearchFiles` | Answered with nothing (`warn` log) |
| System calls | `SystemRequest`, except reads under `/sys`, lock screen readouts and calls that stop something running | A call that starts something is answered `locked`; `stdin` is dropped (`warn` log) |
| Allowed | `ChromeHello`, `Lock`, `Unlock`, `KeyboardFocus`, output scale and size, window bounds, `ClipboardCopied`, theme | Handled normally |

Why some requests are allowed:

- `ChromeHello`: a reloaded page learns the desktop is locked from the answer.
- `SetOutputScale`, `SetOutputSize`, `SetAppBounds`: nothing replays them
  after unlock.
- `KeyboardFocus`: refusing it would leave the shell and the compositor disagreeing
  about focus after unlock. No key reaches the window while locked anyway.
- `ClipboardCopied`: it is a client's copy, and the history must match pastes.
- `SetTheme`: it opens and reads nothing.
- System reads under `/sys`: the user can change nothing there. Only an
  absolute path with no `..` counts.
- Lock screen readouts: the calls `system-battery`, `system-backlight`,
  `system-audio` and `system-bluetooth` make, so a lock screen shows the
  battery and Bluetooth and sets the brightness and volume. See
  [Lock screen readouts](#lock-screen-readouts).
- `unwatch`, `close_stdin`, `kill`: they stop what the shell started.

## Lock screen readouts

Each call reads state or changes what a laptop's brightness and volume keys
change, so someone at a locked desktop learns or does nothing more.
`domicile_host::lock_screen_readouts` lists each one field by field; `reach`
judges a request `Reach::Readout` only on a full match.
`packages/domicile-protocol/wire/lock-screen-readouts.jsonl` records what each
library sends; the libraries' tests and the allowlist's both check it.

| Library | Call |
|---|---|
| `system-battery` | UPower `DisplayDevice` `GetAll` of `org.freedesktop.UPower.Device`; a match on its `PropertiesChanged` with every field set |
| `system-backlight` | `udevadm monitor --kernel --subsystem-match=backlight`; logind `Session.SetBrightness("backlight", device, level)` on `session/auto` |
| `system-audio` | `pactl -f json info`, `list` and `subscribe`; `pactl -- set-sink-volume NAME N` and `set-sink-mute NAME 0\|1` |
| `system-bluetooth` | BlueZ `GetManagedObjects` on `/`: adapters' power, connected devices and their batteries; a match on every BlueZ signal |

- D-Bus calls are on the system bus only.
- A spawn has no `cwd` or `stdin`, and exactly the library's `env`: none for
  `udevadm`, `LC_ALL=C` for `pactl`.
- `argv[0]` is looked up on the compositor's `PATH`, like every spawn. The lock
  trusts whatever `udevadm` and `pactl` that `PATH` finds.
- Left out: inputs (unmuting a microphone would let a locked desktop record),
  `parec` meters, and every other `pactl` command.
- Left out of BlueZ: power, scanning, pairing and connecting. Someone at a
  locked desktop must not pair a device.

## Ordering

- **Input counts as activity before it is refused.** `keep_the_desktop_awake`
  runs first, so a key at a locked desktop lights the screens.
- **The lock state changes before the shell is told.** `Lock` updates the state
  that `Seen` reads, under its mutex, before queuing `locked`. A search sent
  after `locked: true` is refused. One sent after `unlock` but before the
  verdict is also refused.
- **The shell is told before the modeset**, so the lock screen is up before the
  screens light.
- **The compositor releases held keys when the desktop locks** (`release_pressed_keys`).
  The refusal would drop the release and leave the key stuck down.

## Verifiers

`crate::lock::Verifier` checks a passphrase. The config picks one:

| `lock` setting | Verifier | Note |
|---|---|---|
| `"pam_service": "domicile"` | `crate::pam`: `pam_authenticate` as the compositor's uid | The machine must declare the service: `nixosModules.default`, or `security.pam.services.domicile = {};`. A home-manager module cannot |
| `"passphrase": "…"` | String compare | Stored in a world-readable file. Guards against someone at the keyboard only |
| neither | none | The desktop never locks |
| both | refused at parse | Neither is a fallback for the other |

## Checking a passphrase

- `pam_unix` sleeps on a wrong password, so the check runs on its own thread.
  `Lock::offered` starts it; the verdict returns over a calloop channel to
  `heard_the_verdict`, which calls `Lock::answered`.
- The desktop stays locked during the check. A second `unlock` during a check is
  dropped.
- A passphrase containing NUL is refused before PAM sees it. C would read only
  the part before the NUL.
- `domicile_protocol::Passphrase` does not print itself, so no log line holds
  what was typed. Linux-PAM overwrites its copy before freeing it.
- A refusal sends `locked: true` to every chrome again.

## Failures fail closed

Only `PAM_AUTH_ERR` means a wrong passphrase. Any other PAM failure is
`Unlocking::Unverifiable`: the desktop stays locked and the log names the error.

| When | Missing | Result |
|---|---|---|
| Startup | `/etc/pam.d/<service>` | The compositor exits, naming the file and what to declare. Linux-PAM would otherwise fall back to its `other` service |
| Startup | `libpam.so.0` or its `pam_start_confdir` | The compositor exits, naming the library. PAM is loaded with `dlopen`, so a desktop without PAM needs none |
| Startup | a user for the uid | The compositor exits |
| Each attempt | `/etc/pam.d/<service>` removed | `Unverifiable` |

`pam_start_confdir` gets `/etc/pam.d` explicitly, so the checked directory and
the read directory match.

## Log lines

```
nobody is at this desktop; it locks itself
this desktop is locked; what the shell forwarded reaches no client
this desktop is locked; what the shell asked for is not done
checking a passphrase; the desk stays locked meanwhile
a passphrase this desktop did not take; it stays locked
the passphrase opened this desktop
this desktop could not check a passphrase, so it stays locked
```
