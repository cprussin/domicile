# @domicile-desktop/app-settings

The Settings app: an app module, `settings.js`, that edits the desktop's
config, its shell's source, its extensions, its site permissions and site data. See
[SETTINGS.md](/docs/SETTINGS.md) and
[APP-MODULES.md](/docs/architecture/APP-MODULES.md).

```sh
domicile run-app .vite/app/settings.js
```

- Spawns `domicile-app-host` (`domicile_launch::app_host`) and speaks
  length-prefixed JSON with it over stdin and stdout.
- Writes each change as soon as it is made. A read-only or module config is
  shown, not changed, with the reason.
- Follows `prefers-color-scheme` and `prefers-reduced-motion`, which Domicile
  sets from the desktop.

## Layout

| Path | What |
|---|---|
| `src/index.tsx` | `main(root, host)`, the module's entry. |
| `src/host.ts` | The settings host process, every reply parsed with Zod. |
| `src/extensions.ts` | The browser's extensions, through the host. |
| `src/config-document.ts` | The config as JSON: read and set one value, keeping the rest. |
| `src/config-schema.ts` | The config's sections with the compositor's defaults. |
| `src/config-state.ts` | Whether the form can change the config, and why not. |
| `src/pages/` | One component per page. |
| `src/CodeEditor.tsx`, `src/editing.ts` | The text editor and its keys. |
| `icons/` | The app icon and the launcher preview. |

## Build and test

```sh
bun run turbo build:vite --filter @domicile-desktop/app-settings
bun run turbo test --filter @domicile-desktop/app-settings
```

The build is the module and its source map, in `.vite/app/`.
