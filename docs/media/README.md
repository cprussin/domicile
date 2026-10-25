# Docs media

Screenshots and videos for the docs and landing pages. Every file here is
captured by a script, never by hand, so it can be retaken for each release.

- **Retake them:** run the `Docs media` workflow (`.github/workflows/docs-media.yml`)
  on a branch. It captures on `crux` and commits the results to that branch.
  A pull request that changes a scene does the same.
- **Locally:** `./scripts/docs-media.sh [scene...]` on a machine with a GPU.
  Without a DRM render node, terminal windows come out blank.

## Scenes

A scene is `scripts/docs-media/scenes/<name>.sh`, plus an optional
`scenes/<name>/` directory for its shell and fixtures. It runs in its own
nested sway with these helpers (`scripts/docs-media/lib.sh`):

| Helper | Does |
|---|---|
| `desktop <shell>` | Starts `domicile` on a shell and waits for it to join the compositor. |
| `app <command...>` | Starts a Wayland client on the desktop and waits for its window. |
| `settle <seconds>` | Waits for windows to map and draw. |
| `shot <name>` | Writes `<name>.png` with `domicile screenshot`. |
| `record <name> <seconds>` | Writes `<name>.webm` and `<name>.mp4`, muted. |
| `keys <wtype args...>` | Types into the desktop. |

`foot`, `nvim`, `btop` and JetBrains Mono are on `PATH` for every scene.

## Files

| File | Scene | Shows |
|---|---|---|
| `hero.png`, `hero.webm`, `hero.mp4` | `hero` | The Domicile hero: nvim, a web page and btop in a three-pane shell. |
| `manganese-hero.png`, `manganese-hero.webm`, `manganese-hero.mp4` | `manganese-hero` | The manganese hero: nvim and a browser tiled, then the launcher. |
