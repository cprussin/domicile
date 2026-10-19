# Changesets

Each package has its own version, managed by
[changesets](https://github.com/changesets/changesets).

- A change to a package adds a changeset naming the package and its bump:
  `bun changeset`. CI fails a pull request that changes a workspace package
  without one. A change that releases nothing adds `bun changeset --empty`.
- `domicile` is the distribution package. Name it for a change to the
  compositor, the host, the engine or `distro/`. See
  [`packages/domicile`](/packages/domicile/README.md).
- Bumping a package bumps every package that depends on it.
- On main, `changesets.yml` keeps a "Version packages" pull request open.
  Merging it applies the pending changesets (`bun run version-packages`).
