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
| `click <x> <y>` | Clicks at a point on the output, with a virtual pointer. |
| `config <json>` | The desktop's config, written before `desktop`. Without it the desktop has none. |

`shot`, `record`, `keys` and `click` fail the scene if the engine has exited:
`domicile` restarts it, so the capture would go on with a fresh desktop. A
scene whose engine exited prints the engine's fatal lines, however it ended.

`foot`, `nvim`, `btop`, `wl-copy`, `grim`, `notify-send`, `ffmpeg` and JetBrains Mono are on `PATH` for every scene.

## Files

| File | Scene | Shows |
|---|---|---|
| `hero.png`, `hero.webm`, `hero.mp4` | `hero` | The Domicile hero: nvim, a web page and btop in a three-pane shell. |
| `manganese-hero.png`, `manganese-hero.webm`, `manganese-hero.mp4` | `manganese-hero` | The manganese hero, from an empty desktop: nvim and a browser opened and tiled, the launcher opening Settings, a notification, tabs and back, then the notification drawer. |
| `tour-tiling.png`, `tour-tiling.webm`, `tour-tiling.mp4` | `tour-tiling` | Three terminals tabbed, then split, then one floated. |
| `tour-browser.png` | `tour-browser` | nvim beside a browser window. |
| `tour-launcher.png`, `tour-launcher.webm`, `tour-launcher.mp4` | `tour-launcher` | The launcher over a terminal and a browser, then "set" typed. |
| `tour-clipboard.png` | `tour-clipboard` | The clipboard history with text and an image. |
| `tour-screenshots.png` | `tour-screenshots` | The screenshot dialog. |
| `tour-lock.png` | `tour-lock` | The lock screen. |
| `tour-web-apps.png` | `tour-web-apps` | A site opened as an app, beside nvim. |
| `tour-notifications.png`, `tour-notifications.webm`, `tour-notifications.mp4` | `tour-notifications` | Two toasts arriving, then the drawer opening. |
| `tour-bar.png` | `tour-bar` | The bar from just left of the clock to the right edge, over a browser window. |
| `tour-settings.png` | `tour-settings` | The Settings app beside nvim. |
| `tour-extensions.png` | `tour-extensions` | uBlock Origin Lite's popup, open from the tray over a browser window. |
| `tour-monitors.png`, `tour-monitors.webm`, `tour-monitors.mp4` | `tour-monitors` | Two monitors side by side, and a browser window moving from the left one to the right one. |
| `configure-settings.png` | `configure-settings` | The Settings app's Shell page, with the clock set to 12-hour. |
| `shell-quickstart.png` | `shell-quickstart` | The shell quickstart's example shell: nvim editing it, beside btop. |
