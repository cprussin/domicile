# Docs media

Screenshots and videos for the docs and landing pages. Every file here is
captured by a script, never by hand, so it can be retaken for each release.

- **Retake them:** run the `Docs media` workflow (`.github/workflows/docs-media.yml`)
  on a branch. It captures on `crux` and commits the results to that branch.
  A pull request that changes a scene does the same.
- **Locally:** `packages/site/scripts/docs-media.sh [scene...]` on a machine with a GPU.
  Without a DRM render node, terminal windows come out blank.

## Scenes

A scene is `packages/site/scripts/docs-media/scenes/<name>.sh`, plus an optional
`scenes/<name>/` directory for its shell and fixtures. It runs in its own
nested sway with these helpers (`packages/site/scripts/docs-media/lib.sh`):

| Helper | Does |
|---|---|
| `desktop <shell>` | Starts `domicile` on a shell and waits for it to join the compositor. |
| `app <command...>` | Starts a Wayland client on the desktop and waits for its window. |
| `settle <seconds>` | Waits for windows to map and draw. |
| `shot <name>` | Writes `<name>.png` with `domicile screenshot`. |
| `record <name> <seconds>` | Writes `<name>.webm` and `<name>.mp4`, muted. |
| `keys <wtype args...>` | Types into the desktop. |

`shot`, `record` and `keys` fail the scene if the engine has exited:
`domicile` restarts it, so the capture would go on with a fresh desktop. A
scene whose engine exited prints the engine's fatal lines, however it ended.

`foot`, `nvim`, `btop`, `wl-copy`, `grim` and JetBrains Mono are on `PATH` for every scene.

## Files

| File | Scene | Shows |
|---|---|---|
| `hero.png`, `hero.webm`, `hero.mp4` | `hero` | The Domicile hero: nvim, a web page and btop in a three-pane shell. |
| `manganese-hero.png`, `manganese-hero.webm`, `manganese-hero.mp4` | `manganese-hero` | The manganese hero: nvim and a browser tiled, then the launcher. |
| `tour-tiling.png`, `tour-tiling.webm`, `tour-tiling.mp4` | `tour-tiling` | Three terminals tabbed, then split, then one floated. |
| `tour-browser.png` | `tour-browser` | nvim beside a browser window. |
| `tour-launcher.png`, `tour-launcher.webm`, `tour-launcher.mp4` | `tour-launcher` | The launcher over a terminal and a browser, then "set" typed. |
| `tour-clipboard.png` | `tour-clipboard` | The clipboard history with text and an image. |
| `tour-screenshots.png` | `tour-screenshots` | The screenshot dialog. |
| `tour-lock.png` | `tour-lock` | The lock screen. |
