# @domicile-desktop/distro

How Domicile is packaged, and the tests of it.

- `*.sh`, `nfpm.yaml`, `pam/`, …: build the Debian, RPM and Arch packages
  (`build.sh`), their signed repositories (`repo.sh`) and the AUR package
  (`aur.sh`).
- `share/`: files every distribution installs, the Nix packages included:
  the login session, launchers, portal, systemd targets and D-Bus service.
- `nix/`: the NixOS and Home Manager modules.
- `tests/`, `lib/`: checks of the above and of `flake.nix`.

## Test

```sh
bun run turbo test:shell --filter=@domicile-desktop/distro   # no nix or docker
bun run turbo test:nix --filter=@domicile-desktop/distro     # needs nix
DOMICILE_DISTRO_REPO=$PWD/distro-repo \
  bun run turbo test:distro --filter=@domicile-desktop/distro
```

| Task | Checks | Needs | Run by |
|---|---|---|---|
| `test:shell` | `tests/test-*.sh`: the packaging scripts, against stand-ins | bun | `turbo test` |
| `test:nix` | `tests/nix-*.sh`: the flake's packages, shells, checks and VM tests | nix | `check.sh nix`, `nix-build.yml` |
| `test:distro` | `tests/distro-*.sh`: each package installed in its distribution's container | docker and `packages/distro/build.sh`'s output | `check.sh distro`, `distro-packages.yml` |

- `test:nix` and `test:distro` are never cached: they build outside turbo's
  view.
- `lib/nix-check.sh` skips a check when nix is missing.
  `lib/distro-installed.sh` checks an installed package from inside its
  container.
- Each check is run by [`check-runner`](../check-runner/README.md).
