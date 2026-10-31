# @domicile-desktop/check-runner

## 0.0.2

### Patch Changes

- 4432cb1: Adds `check-runner`, which runs a package's shell checks under turbo's `test:shell`; the skip scan moves to it from `e2e-harness`.
- 13107cb: The tests of the distribution packages and the flake move from `scripts/` into the `distro-checks` package, as `test:shell`, `test:nix` and `test:distro`.
