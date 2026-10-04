# domicile-engine

Domicile's Chromium fork, kept as a patch series on a pinned Chromium revision.

- The fork makes `<app>` a `cc::SurfaceLayer` that embeds a viz surface the
  compositor submits. CSS then applies to a window like any other element.
- It also adds an Ozone DRM platform, the shell's control channel, and
  `<webview>` browser windows.
- Design: [ENGINE-FORK.md](/docs/architecture/ENGINE-FORK.md). Measurements:
  [ENGINE-FORK-MEASUREMENTS.md](/docs/architecture/ENGINE-FORK-MEASUREMENTS.md).

## Why a patch series

- Most of the fork is new files, and new files never conflict on a rebase.
- The edits to Chromium's own files (mostly the DRM work in
  `ui/ozone/platform/drm` and `ui/events/ozone/evdev`) are `patches/`. Their
  count is the rebase cost, and a series keeps it visible:

  ```sh
  grep -h '^diff --git' patches/*.patch | awk '{print $3}' | sed 's|^a/||' | sort -u | wc -l
  ```

## Layout

| Path | Contents |
|---|---|
| `CHROMIUM_PIN` | the Chromium revision the series applies to |
| `src/` | new files, copied into the checkout at the same path |
| `patches/` | `git format-patch` output for edits to Chromium's files |
| `upstream/` | Chromium bugs found here, written up to file upstream |
| `scripts/apply.sh` | applies the series to a Chromium checkout |
| `scripts/extract.sh` | writes the checkout's commits back to `patches/` |
| `scripts/build.sh` | `gn gen` and `autoninja` |
| `scripts/guard-*`, `spike-*` | end-to-end checks; see [docs/GUARDS.md](docs/GUARDS.md) |
| `engine-release.nix`, `engine-official.nix`, `engine-pin.nix` | the prebuilt engines the flake uses |

## Using a prebuilt engine

```sh
nix build .#engine
```

- Fetches a prebuilt engine, checks its hash, and patches it to run on NixOS.
- The engine a commit runs is pinned in that commit. See
  [docs/RELEASES.md](docs/RELEASES.md).
- `DOMICILE_ENGINE=<dir>` runs another build instead. `<dir>` holds `chrome`,
  for example a checkout's `out/Domicile`.

## Working on it

The engine builds only on `crux`, at `/build/chromium/src`.

```sh
./scripts/apply.sh   /build/chromium/src     # lay the series down
./scripts/build.sh   /build/chromium/src     # gn gen + autoninja
# ... work in the checkout, commit there ...
./scripts/extract.sh /build/chromium/src     # write it back here
```

- Write in this repo and compile in the checkout.
- Copy new files into `src/` by hand. `extract.sh` cannot tell a new source
  file from build output. See
  [BUILD-MACHINE.md](docs/BUILD-MACHINE.md#sharing-the-checkout-with-ci).
- Make a patch against the series, not the bare pin. Patch N applies on top of
  patches 1 to N-1. `scripts/test-patch-series-chain.sh` checks the chain.
- Sharing the checkout with CI, the tree lock and the toolchain shell:
  [docs/BUILD-MACHINE.md](docs/BUILD-MACHINE.md).
- First-time setup and build arguments:
  [docs/BUILDING-CHROMIUM.md](docs/BUILDING-CHROMIUM.md).
- Moving the pin: [BUILD-MACHINE.md](docs/BUILD-MACHINE.md#moving-the-pin).
- Tests: [docs/TESTING.md](docs/TESTING.md).

## More

- [docs/CONTROL-CHANNEL.md](docs/CONTROL-CHANNEL.md): `window.domicile` and the
  command socket
- [docs/SOURCE-MAP.md](docs/SOURCE-MAP.md): where the surface-embedding code
  lives
