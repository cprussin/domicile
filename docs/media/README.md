# Docs media

Screenshots and videos for the docs and landing pages. Every file here is
captured by a script, never by hand, so it can be retaken for each release.

- **Retake them:** run the `Docs media` workflow (`.github/workflows/docs-media.yml`)
  on a branch. It captures on `crux` and commits the results to that branch.
  A pull request that changes a scene does the same.
- **Locally:** `packages/site/scripts/docs-media.sh [scene...]` on a machine with a GPU.
  Without a DRM render node, app windows come out blank.

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
| `record_start <name>`, `record_end` | The same, from one to the other. |
| `caption <text>` | Shows `<text>` at the foot of the recording, for the key pressed next. |
| `keys <wtype args...>` | Types into the desktop, then waits `KEYS_SETTLE` seconds (1 unless the scene sets it). |
| `click <x> <y>` | Clicks at a point on the output, with a virtual pointer. |
| `config <json>` | The desktop's config, written before `desktop`. Without it the desktop has none. |

`shot`, `record`, `keys` and `click` fail the scene if the engine has exited:
`domicile` restarts it, so the capture would go on with a fresh desktop. A
scene whose engine exited prints the engine's fatal lines, however it ended.

`foot`, `nvim`, `wl-copy`, `grim`, `notify-send`, `ffmpeg` and JetBrains Mono are on `PATH` for every scene.

Real desktop apps, run as `domicile` runs them (Wayland only, in the scene's own home), each started and waited for like `app`:

| Helper | Starts |
|---|---|
| `game [WxH]` | SuperTuxKart, every kart driven by the computer. |
| `movie` | Big Buck Bunny (Blender Foundation, CC BY 3.0) in mpv, muted. `docs-media.sh` fetches it. |
| `blender_scene` | Blender on `fixtures/blender/scene.py`'s scene, its animation playing. |
| `photo` | GIMP on a photo from KDE's wallpapers, which `$PHOTO` names. |
| `document` | LibreOffice Writer on `fixtures/trip.html`. |

## Files

| File | Scene | Shows |
|---|---|---|
| `hero.png`, `hero.webm`, `hero.mp4` | `hero` | The Domicile hero: SuperTuxKart, a web page and Big Buck Bunny in a three-pane shell. |
| `manganese-hero.png`, `manganese-hero.webm`, `manganese-hero.mp4` | `manganese-hero` | The manganese hero, from an empty desktop: Blender opened from the launcher, a web page opened beside it and Settings, then a notification. Captions name each key. |
| `tour-tiling.png`, `tour-tiling.webm`, `tour-tiling.mp4` | `tour-tiling` | Blender, GIMP and a film tabbed, then split, then one floated. Captions name each key. |
| `tour-browser.png` | `tour-browser` | LibreOffice beside a browser window. |
| `tour-launcher.png`, `tour-launcher.webm`, `tour-launcher.mp4` | `tour-launcher` | The launcher over Blender and a browser, then "set" typed. |
| `tour-clipboard.png` | `tour-clipboard` | The clipboard history with text and an image, over GIMP. |
| `tour-screenshots.png` | `tour-screenshots` | The screenshot dialog, over a film and a browser. |
| `tour-lock.png` | `tour-lock` | The lock screen, over a game. |
| `tour-web-apps.png` | `tour-web-apps` | A site opened as an app, beside LibreOffice. |
| `tour-notifications.png`, `tour-notifications.webm`, `tour-notifications.mp4` | `tour-notifications` | Two toasts arriving over a game, then the bell clicked to open the drawer. |
| `tour-bar.png` | `tour-bar` | The bar from just left of the clock to the right edge, over a film and a browser window. |
| `tour-settings.png` | `tour-settings` | The Settings app beside GIMP. |
| `tour-extensions.png` | `tour-extensions` | uBlock Origin Lite's popup, open from the tray over a browser window. |
| `tour-monitors.png`, `tour-monitors.webm`, `tour-monitors.mp4` | `tour-monitors` | Two monitors side by side, and SuperTuxKart moving from the left one to the right one mid-race, beside a browser window. |
| `configure-settings.png` | `configure-settings` | The Settings app's Shell page, with the clock set to 12-hour. |
| `quickstart.png`, `quickstart.webm`, `quickstart.mp4` | `quickstart` | The Domicile page's quickstart: nvim and the example shell, nvim beside a film, then a wider gap from an edit and `domicile load-shell`. Captions name each step. |
| `live-swap.png`, `live-swap.webm`, `live-swap.mp4` | `live-swap` | The Domicile page's live swap: SuperTuxKart beside asciiquarium in a terminal, then `domicile load-shell` stacks them. Both keep going. |
| `shell-quickstart.png` | `shell-quickstart` | The shell quickstart's example shell: nvim editing it, beside a film. |
