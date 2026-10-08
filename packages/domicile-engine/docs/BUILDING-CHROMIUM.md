# Building Chromium for the engine

How to get a Chromium checkout and build the engine from scratch. The day-to-day
loop (`apply.sh`, `build.sh`, `extract.sh`) is in the
[package README](../README.md).

## Machine

- Chromium needs x86-64, at least 8 GB of RAM (16 GB+ recommended) and 100 GB
  of disk (`docs/linux/build_instructions.md` in the Chromium tree).
- `crux` is the build machine.
- Build times: see [BUILD-MACHINE.md](BUILD-MACHINE.md#build-cost).

## Checkout

```sh
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
export PATH="$PWD/depot_tools:$PATH"
mkdir chromium && cd chromium
fetch --nohooks chromium && cd src
./build/install-build-deps.sh      # skip on NixOS; use the Nix shell below
gclient runhooks
```

On NixOS, run the build (below) inside Chromium's dev shell:
`nix-shell tools/nix/shell.nix`.

## Build

`scripts/build.sh` runs `gn gen` and `autoninja` with the arguments below. Its
header explains each one.

```
is_debug = false
symbol_level = 0
is_component_build = true
use_ozone = true
ozone_auto_platforms = false
ozone_platform_wayland = true
ozone_platform_headless = true
ozone_platform_drm = true
use_libinput = true
import("//build/args/domicile_codecs.gn")
```

- **`ozone_platform_headless`** is for `crux`, which has no display server.
  Without it the engine cannot start there.
- **`ozone_platform_drm`** needs patch `0012`: upstream asserts DRM is
  ChromeOS-only. Patches `0013` and `0016` add the embedder behind it. The
  default platform is unchanged. See
  [A-DESKTOP-ON-A-TTY.md](/docs/architecture/A-DESKTOP-ON-A-TTY.md).
- **`use_libinput`** gives evdev a touchpad path off ChromeOS.
- **`domicile_codecs.gn`** turns on H.264 and AAC. It is under `src/`, so
  `apply.sh` lays it into the checkout before the build.

## Pitfalls

- **A failed `gn gen` breaks the output directory.** gn writes `args.gn` before
  an assert fires, and ninja reruns gn on every build, so every later build
  fails with `rebuild manifest failed`. `build.sh` always passes `--args`, which
  repairs the tree.

## Running

`scripts/spike.sh` documents the run flags.

- `--password-store=basic` is required. Without it Chrome blocks on a missing
  keyring and never opens a window.
- `--disable-gpu` is the default. `GPU=1` uses the GPU; see
  [ENGINE-FORK-CHROMIUM-NOTES.md](/docs/architecture/ENGINE-FORK-CHROMIUM-NOTES.md#running-on-the-gpu).

## Rolling the pin

- A repin is a pull request. The engine workflows sync the checkout (see
  [Moving the pin](BUILD-MACHINE.md#moving-the-pin)).
- **Check `src/` after a roll.** `src/` is a copy, so `git am` never rejects
  it. A signature change that reaches a file there fails at compile time.

## Reading Chromium source from a container

The egress proxy blocks `chromium.googlesource.com` and `source.chromium.org`
(403). GitHub is allowed.

One file at the pinned revision:

```sh
curl "https://raw.githubusercontent.com/chromium/chromium/$(tail -1 \
  packages/domicile-engine/CHROMIUM_PIN)/components/viz/service/display/overlay_candidate_factory.cc"
```

To grep across directories, use a blobless sparse clone (about 154 MB):

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/chromium/chromium /home/user/chromium/chromium
git -C /home/user/chromium/chromium sparse-checkout set \
  components/exo cc/layers cc/trees components/viz services/viz \
  content/browser/renderer_host ui/ozone/platform/wayland \
  third_party/blink/renderer/core/frame \
  third_party/blink/renderer/platform/graphics
```
