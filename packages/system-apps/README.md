# @domicile-desktop/system-apps

Installed applications and bookmarks for a shell's launcher, read through
[`@domicile-desktop/sdk/system`](../chrome-sdk/README.md). Manganese's launcher
uses it (`src/launcher/app-search.ts`), and the component library's portal
dialogs name applications with it.

## Usage

```ts
import { system } from "@domicile-desktop/sdk/system";
import { appIcons } from "@domicile-desktop/system-apps/app-icons";
import { dataDirs } from "@domicile-desktop/system-apps/data-dirs";
import { findApps } from "@domicile-desktop/system-apps/find-apps";
import { installedApps } from "@domicile-desktop/system-apps/installed";

const host = system(domicile);
const dirs = (await dataDirs(host)).unwrapOr([]);
const apps = (await installedApps(host, dirs)).unwrapOr([]);
const icon = appIcons(host, dirs);
const editors = findApps(apps, "edit", 50);
```

## Modules

| Module | What it is |
| --- | --- |
| `./data-dirs` | The XDG data directories, from the desktop's environment (`env -0`). |
| `./installed` | Every desktop entry under them; an earlier directory hides a later one's ID. |
| `./desktop-entry` | One entry parsed: name, comment, argv, icon and `X-Domicile-Preview`. |
| `./find-apps`, `./bookmark` | The launcher's matching and ranking; bookmarks and their Zod schema. |
| `./describe-apps` | Application IDs named and drawn by their entries, in the config's icon theme, for a shell to say who asks. |
| `./mime-apps` | A content type's default applications from every `mimeapps.list`, the desktop's own (`domicile-mimeapps.list`) first. |
| `./openers` | The applications that open a file, its default first, and the argv each opens it with. The type comes from shared-mime-info's `mime/globs2`, by name. |
| `./omit` | Desktop file IDs left out, as globs. |
| `./app-icons` | Icon names resolved to `data:` URLs (PNG, SVG, 128 KiB at most) by the icon theme spec: a theme, its `Inherits`, `hicolor`, then `pixmaps`, at the size asked for, in `apps` or the contexts given. `themedIcons` falls back to `<name>-symbolic` and says which icons are symbolic. Pass the theme `readIconTheme` reads. |
| `./favicon`, `./curl`, `./favicons` | A bookmark's icon: picked from the page, fetched with `curl`, kept and retried. |
| `./fake-system` | A `System` over an in-memory tree, for tests. Its Settings portal serves the icon theme it is given. |

- Calls resolve `Result`s with the SDK's `SystemError`; a missing or
  unreadable file or directory is skipped, as the specs say.
- `./curl` needs `curl` on the desktop's `PATH`. Domicile's Nix package adds
  it.
- Launching stays with the shell: pass an entry's `command`, or an
  `openers` result's `command(app)`, to `spawn`.

## Test

```sh
bun run turbo test --filter @domicile-desktop/system-apps
```

Entry parsing is tested on files under `src/recorded/`, copied from real
installs.
