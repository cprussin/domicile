# domicile

The version of `domicile`, the distribution package for Debian, Ubuntu,
Fedora, openSUSE and Arch. `distro/` builds it.

- Lists the workspace packages the distribution package bundles as
  dependencies, so a release of any of them bumps it.
- A change that reaches the package only through Rust or the engine names
  `domicile` in its changeset.

See [`.changeset/README.md`](/.changeset/README.md).
