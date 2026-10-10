# @domicile-desktop/app-settings

The Settings app: an unpacked MV3 Chrome extension whose page,
`settings.html`, edits the desktop's config, its shell's source, its
extensions and its site permissions. See [SETTINGS.md](/docs/SETTINGS.md).

- Reaches the desktop through its native messaging host,
  `domicile-settings-host` (`domicile_launch::settings`).
- Writes each change as soon as it is made. A read-only or module config is
  shown, not changed, with the reason.
- Follows `prefers-color-scheme` and `prefers-reduced-motion`, which Domicile
  sets from the desktop.

The manifest's `key` pins the id, so
`domicile open-app chrome-extension://acpgnhiblklkgbkcjgbabkcmdmchdphk/settings.html`
opens it, and the host's manifest lets only this id start it.

## Layout

| Path | What |
|---|---|
| `src/host.ts` | The native messaging host, every reply parsed with Zod. |
| `src/extensions.ts` | `chrome.management`, parsed. |
| `src/config-document.ts` | The config as JSON: read and set one value, keeping the rest. |
| `src/config-schema.ts` | The config's sections with the compositor's defaults. |
| `src/config-state.ts` | Whether the form can change the config, and why not. |
| `src/pages/` | One component per page. |
| `src/CodeEditor.tsx`, `src/editing.ts` | The text editor and its keys. |
| `public/manifest.json` | The extension manifest. |
| `icons/` | The app icon and the launcher preview. |

## Build and test

```sh
bun run turbo build:vite --filter @domicile-desktop/app-settings
bun run turbo test --filter @domicile-desktop/app-settings
```

The build is the whole extension, in `.vite/extension/`. The flake copies it
to `libexec/domicile/apps/settings`.
