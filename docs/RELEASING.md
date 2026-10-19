# Releasing

A release promotes `stable` to `release` and publishes every package version
it holds that is not published yet.

## Branches

- **`main`**: every merge publishes npm alphas, `0.0.0-alpha-<sha>`, under
  `next`.
- **`stable`**: the newest main that runs the official engine. Moves on its
  own (`stable.yml`).
- **`release`**: the newest release. Moves only through the release below.

## Versions

Each package has its own version, set by changesets
([/.changeset/README.md](/.changeset/README.md)):

1. A pull request adds a changeset naming what it changes.
2. On main, `changesets.yml` keeps a "Version packages" pull request open
   that applies the pending changesets.
3. Merging it sets the versions. `stable` picks them up with the next official
   engine.

`domicile` is the distribution packages' version. A change to the Rust
crates, the engine or `distro/` names it in its changeset.

## Cutting a release

Run **Publish packages** (`publish-packages.yml`) with `release` checked:

1. Checks `stable`: ahead of `release`, no pending changesets, `domicile`
   past 0.0.0 (`.github/scripts/release-check.sh`).
2. Builds the distribution packages at their versions and installs each in
   its distribution (`distro-packages.yml`).
3. Publishes to npm under `latest`.
4. Adds the packages to the signed apt, rpm and pacman repositories on R2
   (`release-repos.sh`, `distro/repo.sh`).
5. Commits `domicile-bin` to the AUR (`release-aur.sh`, `distro/aur.sh`).
6. Tags `<package>@<version>` for each new version and `release-<time>`, then
   moves `release` (`release-tag.sh`).

`dry_run` is checked by default: it runs every step and publishes nothing.
Every step skips what is published already, so a failed release is run again
as it is.

## Protection

Two repository rulesets keep what a release published from moving:

- **`release` branch:** restrict deletions, block force pushes. The release
  only fast-forwards it.
- **Release tags** (`release-*`, `*@*`): restrict updates and deletions. The
  release only creates them.

## Secrets

| Name | Kind | What |
|---|---|---|
| `DOMICILE_SIGNING_KEY` | secret | The armored GPG key that signs the repositories. Backed up in `pass` with its revocation certificate. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | secret | An R2 token that reads and writes the bucket. |
| `AUR_SSH_KEY` | secret | The AUR account's SSH key. |
| `R2_ACCOUNT_ID` | variable | The Cloudflare account. |
| `DOMICILE_R2_BUCKET` | variable | The bucket. |
| `DOMICILE_REPO_URL` | variable | The bucket's public address. |

npm needs none: it trusts `publish-packages.yml` by name, which is why the
release is in that workflow.
