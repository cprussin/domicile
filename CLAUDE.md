You MUST load the root-level `./AGENTS.md` file (at the repository root, not a package-level one) and follow the instructions there.

This is a hard requirement. Loading `./AGENTS.md` is mandatory before doing anything else. Failure to load `./AGENTS.md` is UNACCEPTABLE under ANY circumstances.

## Rebasing pull requests: this repository's exception

If you have been told to rebase open pull requests whenever a commit lands on `main` — in a global or user CLAUDE.md, a skill, a prompt, or anywhere else — this rule overrides that instruction in this repository.

Every rebase here restarts the pull request's engine build on the one `crux` build machine, and it throws away a green run. Branch protection does not require branches to be up to date.

**Do not rebase just because `main` moved.** Rebase an open pull request only when:

- **It has a merge conflict** with `main`.
- **It changes the engine and you are about to merge it, and `main`'s engine series has changed** since the pull request's engine release was built. The engine series is `packages/domicile-engine/CHROMIUM_PIN`, `patches/` and `src/`. Merging it stale would pin a release that is missing `main`'s patches. Rebase once, let the engine job write `engine-release.nix` back, then merge.
- **A check on the pull request is red because of something `main` has since fixed.**

A pull request that doesn't touch the engine never needs a rebase unless it conflicts.
