# @domicile-desktop/shell-splash

The page a desktop shows while `domicile` builds its shell on first start.

- An aurora in the accent, the house mark drawing itself, the wordmark, and a
  meter through the builder's steps. Drawn once per display, in the desktop's
  theme and accent.
- `domicile` shows it only when the first build takes over 500 ms. It copies
  the prebuilt page into the run's directory and writes `progress.json` beside
  it; the page polls that file. `domicile load-shell` and config reloads never
  show it. See `domicile_launch::splash`.
- On `built` it plays a 900 ms ending, then `domicile` loads the shell.
- On `failed` it shows the builder's error. Any key stops `domicile`
  (`kill -TERM`), which logs out.

## Layout

| Path | What |
|---|---|
| `src/index.tsx` | `Shell`: applies the theme and accent, mounts `Splash`. |
| `src/Splash.tsx` | The page. |
| `src/progress.ts` | Parses `progress.json`. |
| `src/follow-progress.ts` | Polls it. |
| `src/host-displays.ts` | The host's displays for `<Screen>`. |
| `panda.config.ts` | Keyframes, durations and the aurora's registered colors. |

## Build and test

```sh
bun run turbo build:vite --filter @domicile-desktop/shell-splash
bun run turbo test --filter @domicile-desktop/shell-splash
```

The flake installs the build at `libexec/domicile/shells/splash`.
`DOMICILE_SHELLS` points a checkout's `domicile` at another directory of
shells.
