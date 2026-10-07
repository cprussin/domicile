# Hardware checks

Checks that need a machine with a lit panel. No agent or CI runner here has
one: `crux` has a GPU but no panel, and the container has no `/dev/dri`. Each
check is one run with a log line to look for. Run with `--vmodule=drm*=1` to
see the `configuring N display(s)` lines.

## Suspend and resume

Close the lid, then open it.

- No `the machine is awake` line: `PrepareForSleep` never arrived and
  `DrmSleep` is not subscribed.
- `the machine is awake` with no `configuring N display(s)` after it: the
  relight ran and the modeset did not.

## Console switch

Press `Ctrl+Alt+F<n>` and switch back. Expect `configuring N display(s)`.

## Dead GPU process

```sh
pkill -f 'chrome.*--type=gpu-process'
```

Expect the screen back within seconds and no `failed to take DRM master` line.

## Dead compositor

```sh
pkill domicile-compositor
```

- Expect a new desktop within a second.
- Expect `starting the desktop again in 1s — that is failure 1 of 5 in a row.`
- The windows do not come back. This is expected; see
  [ROADMAP item 2](../ROADMAP.md#in-this-repository).

## Dead engine with windows open

Start a desktop with two clients: one that keeps drawing, and one idle (a
terminal nobody types in). Then:

```sh
pkill -f 'chrome.*--domicile-broker-socket'
```

Expect, in order:

1. `the engine exited`
2. `starting the engine again in 1s — that is failure 1 of 5 in a row.`
3. One new engine, and no second `domicile is up`.
4. From the compositor: `the engine this desktop was drawing through has been
   replaced; rejoining it`
5. `rejoined the engine and restated this desktop to it shown=2 blank=0`

Pass: both windows still show what they showed, including the idle one. The
idle client does not redraw, so it shows only if the compositor restored its
last frame.

Fail: `blank=` above zero, or an `on the page with nothing in it` line.

Elsewhere, `scripts/test-a-desktop-that-fails-says-why.sh` covers the
launcher against fake components, and unit tests cover the compositor's
decisions. Only this run covers the real `dlopen`, reconnect and re-import.

## Float dragged across monitors

With two monitors and a floating terminal on the left, Meta+drag it right
until its middle passes the edge.

- Expect it drawn over both monitors while it crosses.
- Expect it to land on the right monitor and keep following the pointer until
  release.
- If it stops at the edge, the page stopped getting pointer moves when the
  pointer crossed CRTCs. See
  [ONE-PAGE-FOR-THE-DESK.md](architecture/ONE-PAGE-FOR-THE-DESK.md#input).

## Monitors at different densities

With a less dense monitor beside the host (`home-office-right-two`), resize a
window on it, then drag a float across onto it.

- Expect no flash of solid color on that monitor. A region may go soft for a
  frame, then sharp.
- Expect no `tile memory limits exceeded` in the engine log.
- With `--show-composited-layer-borders`, expect tiles about one monitor wide
  or narrower, never a row across the desk.
- See [DISPLAY-TILINGS.md](architecture/DISPLAY-TILINGS.md#tile-memory).

## Idle blanking

Set `idle.blank_after_seconds = 60`, leave the machine for a minute, then
touch the trackpad. Expect:

- `nobody is at this desktop; its screens go dark connectors=N`, and the
  panels off.
- `somebody is at this desktop again; its screens come back on`, then
  `configuring N display(s)`.

Then plug in a monitor while the screens are dark. It must come up dark too.

## Display manager session

Import `nixosModules.default` and set:

- `programs.domicile.enable`
- `services.displayManager.defaultSession = "domicile"`
- a `shell` in the config

The login screen should offer `domicile` and boot into that shell on the drm
platform. CI only checks that this evaluates.

## PAM lock

Import `nixosModules.default` and set `programs.domicile.enable`,
`lock.pam_service = "domicile"` and `idle.blank_after_seconds = 60`. Leave the
machine until it locks.

- Your password gives `the passphrase opened this desktop`.
- A wrong password gives `a passphrase this desktop did not take` a couple of
  seconds later (`pam_unix`'s delay).
- Clients keep drawing throughout.

Tests cover real libpam through `pam_exec` with a script as the password
check. Only this run covers `pam_unix`, a real password and its setuid helper.

## Latency on a panel

From a console login, in a checkout:

```sh
nix build .#engine
nix develop .#full --command cargo build -p domicile-compositor
ENGINE="$(readlink -f result)"
nix develop .#full --command env OUT=. PLATFORM=drm \
  ./packages/domicile-engine/scripts/guard-latency.sh "$ENGINE"
```

- The verdict line compares `commit to pixel` with the run's `display frame`.
  The ratio matters, not the milliseconds.
- `answered too late` above zero means fewer rounds were measured than
  planned.
- `OUT=.` because `nix build .#engine` produces a store path that is itself
  the out directory.
- Call `guard-latency.sh` directly. `scripts/engine-guard-latency.sh` wraps it
  in `under-wayland.sh` and takes `crux`'s render-node lock, which a laptop
  does not need.

## Several monitors

Plug in one monitor, then a second. Expect:

- `configuring N display(s)` for each.
- A bar and a wallpaper on every panel.
- `told the chrome about N display(s)`.

Then check:

- `mod+2` moves keyboard focus to the monitor showing workspace 2 and leaves the
  workspace in place.
- A key bound to `exec` opens its window on the monitor with keyboard focus.
- Moving the pointer to another monitor moves keyboard focus with it.
- Windows keep drawing through all of the above.

Also plug three identical monitors into one MST hub, together and one at a
time. Each should light with one window and no crash. This tests two
behaviors not yet seen on real monitors: a connector no layout names is placed
after the named ones, and a window belongs to its display while its page
loads.

## Monitor cast on a GPU

`guard-display-capture.sh` runs software-composited, so it reads shared
memory. A dmabuf capture needs a GPU and a monitor.

```sh
DOMICILE_CAST_MONITOR=drm-<id> domicile …
pw-link domicile-cast:capture_1 <consumer>:input_1
```

- `DOMICILE_CAST_MONITOR cast … Ready`, then frames in the consumer: the
  capture runs.
- `a captured frame could not be kept`: the dmabuf did not import into the
  compositor's renderer.
- `DOMICILE_CAST_MONITOR=<x>,<y>,<width>x<height>` across two monitors at
  different densities: the stream is at the higher one, with no seam.

## `dev-shell.sh` against a real engine

Run `./scripts/dev-shell.sh <name>` and check:

- A saved edit shows on screen.
- Windows stay where they were.
- A shell that fails to load leaves the current shell running.

`scripts/test-dev-shell.sh` covers the watch loop, coalescing and refusal
against a fake `domicile`.
