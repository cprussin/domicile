# @domicile-desktop/system-apps

Installed applications and bookmarks for a shell's launcher, read through
[`@domicile-desktop/sdk/system`](../chrome-sdk/README.md). Manganese's launcher
uses it (`src/launcher/app-search.ts`).

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
| `./mime-apps` | A content type's default applications from every `mimeapps.list`, the desktop's own (`domicile-mimeapps.list`) first. |
| `./omit` | Desktop file IDs left out, as globs. |
| `./app-icons` | Icon names resolved in `hicolor` and `pixmaps` to `data:` URLs (PNG, SVG, 128 KiB at most). |
| `./favicon`, `./curl`, `./favicons` | A bookmark's icon: picked from the page, fetched with `curl`, kept and retried. |
| `./fake-system` | A `System` over an in-memory tree, for tests. |

- Calls resolve `Result`s with the SDK's `SystemError`; a missing or
  unreadable file or directory is skipped, as the specs say.
- `./curl` needs `curl` on the desktop's `PATH`. Domicile's Nix package adds
  it.
- Launching stays with the shell: pass an entry's `command` to `spawn`.

## Test

```sh
bun run turbo test --filter @domicile-desktop/system-apps
```

Entry parsing is tested on files under `src/recorded/`, copied from real
installs.
