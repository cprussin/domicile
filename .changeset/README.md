# Changesets

Each package has its own version, managed by
[changesets](https://github.com/changesets/changesets).

- A change to a package adds a changeset naming the package and its bump:
  `bun changeset`.
- `domicile` is the distribution package. Name it for a change to the
  compositor, the host, the engine or `distro/`. See
  [`packages/domicile`](/packages/domicile/README.md).
- Bumping a package bumps every package that depends on it.
