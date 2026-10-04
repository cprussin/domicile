# Engine releases

How CI publishes prebuilt engines and how the flake picks one.

## Pinned engines

| File | Build | Made by |
|---|---|---|
| `engine-release.nix` | checked: DCHECKs on, no PGO | `engine.yml`, on the pull request that changes the fork |
| `engine-official.nix` | production: PGO, ThinLTO, no DCHECKs | `engine-release.yml`, nightly from `main` |
| `engine-pin.nix` | picks one of the two | hand-written |

- `engine-pin.nix` uses the official build only when it was built from the
  same series as the checked build. Between a merge that changes the fork and
  the next nightly, `main` runs the checked build.
- `/scripts/update-engine-release.sh` moves `engine-release.nix` to the newest
  release.

## Release names

- A release is tagged `engine-s<identity>`.
- The identity is a content hash of `CHROMIUM_PIN`, `patches/` and `src/`, the
  same value `engine-series-stamp.sh` uses.
- Commits that do not change the fork share a release and need no repin.

## A fork change is one pull request

On a pull request that changes the series, `engine.yml`:

1. builds the release configuration,
2. publishes it,
3. pushes the regenerated `engine-release.nix` onto the branch.

| Script | Role |
|---|---|
| `.github/scripts/engine-release-needed.sh` | decides whether this run must publish a release |
| `.github/scripts/engine-release-repin.sh` | commits `engine-release.nix` onto the branch tip |
| `/scripts/test-the-pinned-engine-is-this-series.sh` | checks the pinned engine matches the series; runs on `ubuntu-latest` |

- The engine's hash is known only after CI builds it, so CI writes
  `engine-release.nix` back instead of the author.
- The last check is red on a fork change until the engine job writes back.
  Red after that is a real failure.
- Force-pushing over the written-back commit is safe. The next run finds the
  release already published, skips the build, and writes the same file.
- `engine-release.yml` also publishes on an `engine-v*` tag.

## The official repin

`engine-release.yml` opens a pull request that updates `engine-official.nix`
(`.github/scripts/engine-official-repin.sh`), with auto-merge on.

It needs the repository secret `DOMICILE_WRITEBACK_TOKEN`. A pull request
opened by `GITHUB_TOKEN` starts no checks. The secret is a fine-grained personal access token:

- Repository access: `cprussin/domicile` only.
- Permissions: Contents, Pull requests and Workflows, read and write.
- The repository allows auto-merge (Settings → General → Pull Requests).

`engine.yml`'s write-back also uses this token when it is set, so its push
starts CI without an approval.
