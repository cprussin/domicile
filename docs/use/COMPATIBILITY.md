# What it runs on

Domicile runs on 64-bit x86 Linux (`x86_64`). Every published build is
`x86_64` only: the distribution packages, the AUR package and the Nix flake's
prebuilt engine. There are no ARM builds.

## Distributions

| Distribution | Package | Installed in CI |
|---|---|---|
| Debian 13, Ubuntu 24.04 | `.deb`, `current` | yes |
| Debian 12, Ubuntu 22.04 | `.deb`, `legacy` | yes |
| Fedora | `.rpm` | yes (Fedora 44) |
| RHEL 10 | the Fedora `.rpm` | no |
| openSUSE Tumbleweed | `.rpm` | yes |
| Arch | `pacman` repository or `domicile-bin` (AUR) | yes |
| NixOS, or Nix anywhere | the flake | builds and VM tests |

"Installed in CI" means `distro-packages-install.sh` installs the package in
that distribution's container for every release and every change to the
packaging. Steps: [Install](INSTALL.md).

## Apps

- Wayland apps run. Electron, SDL and Qt apps are started in Wayland mode.
- There is no Xwayland, so apps that only speak X11 don't run.
- Which apps are checked: [Apps we check](FIRST-STEPS.md#apps-we-check).

## GPUs

| GPU | Status |
|---|---|
| NVIDIA, proprietary driver (GTX 970) | Checked by CI on every engine build, with no monitor attached. The docs' screenshots and videos are taken on it |
| AMD (Radeon 890M, Framework 13) | In daily use on a console login, with monitors through a dock |
| Intel | Tested by hand |
| No GPU | Runs: nested on llvmpipe, and on a console login the desktop draws on the CPU ([how](../architecture/A-DESKTOP-ON-A-TTY.md#software-output)) |

Gaps that can show on a first run:

- **What reaches a lit screen is unmeasured.** Every automated check reads the
  frame back before it is shown.

A blank screen or a display that won't light: [GPU and display
issues](../TTY-DEBUGGING.md). Everything else not done yet: [Known
gaps](../KNOWN-GAPS.md).
