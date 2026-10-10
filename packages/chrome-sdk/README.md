# @domicile-desktop/sdk

Types and helpers for a Domicile shell: the desktop it is handed, the
`<app>` and `<webview>` elements, keybindings and the `Shell` export.

- Published to npm. To write a shell, start with
  [WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md); this README is the package
  reference.
- Ships built JavaScript and `.d.ts` from `dist/`. Run `bun run build` before
  anything outside the workspace imports it.

## Usage

```ts
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";

export const Shell: ShellModule = (root, domicile) => {
  const show = () => {
    // Render `domicile.windows` as `<app app-id="…">` elements into `root`.
  };
  show();
  domicile.addEventListener("windowschanged", show);
};
```

- Domicile calls `Shell(root, domicile)` once. `domicile` is the only copy of
  the desktop; there is no global.
- Nothing to await. The first call on `domicile` binds the channel.
- State is readonly attributes (`windows`, `browserWindows`, `displays`,
  `theme`, …), each with a bare `<name>changed` event. Read, then listen.
- Moments (`shortcut`, `focusrequested`, …) are events. The engine holds each
  type until its first listener exists.
- `searchFiles` returns a promise. A newer call rejects the older with an
  `AbortError`.
- Only Domicile calls a shell. Develop against the real desktop with
  `./scripts/dev-shell.sh <shell>`.
- Render `<app app-id="…">` and `<webview window="…">` as normal DOM. CSS
  (rounding, blur, transforms, z-index) applies to the live surface.
- The engine sends the pointer, wheel and keys over an `<app>` to its client,
  through every CSS transform. `domicile.focusApp(appId)` and
  `domicile.focusChrome()` move the keyboard without a click.
- Both tags are the engine's built-in elements. In React, bind their events on
  a ref; React does not bind `on…` props for unknown events.
- Errors follow [ERRORS.md](/docs/guidelines/ERRORS.md): bugs throw, absence
  is `T | undefined`.

See [docs/ELEMENTS.md](docs/ELEMENTS.md) for `<app>` input and focus, and the
`<webview>` API.

## Modules

| Module | What it is |
| --- | --- |
| `./domicile-host` | `DomicileHost`: the type of the desktop `Shell` is handed. Generated from the engine's IDL; see [Generated types](#generated-types). |
| `./config` | Types for the config file's sections, for a TypeScript config module. Generated; see [Generated types](#generated-types). `./config.schema.json` is the JSON Schema they come from. |
| `./shell` | `Shell`: the export a shell module must provide. Domicile calls it once with the element to draw in. |
| `./app-element`, `./webview-element` | Types and event names for `<app>` and `<webview>`. |
| `./bind-keys` | `bindKeys`: grab a shell's own chords by name and handle them by mode. `./key-action` and `./own-keybindings` are its parts. |
| `./fake-host` | `FakeDomicileHost`: a desktop for a shell's tests. |
| `./file-preview` | `previewFile(system, path)`: a launcher's preview of a path, read through the system calls: a directory's entries, a song's tags and cover, or the start of a text file. |
| `./dbusmenu` | `watchMenu(system, { bus, path })`: a tray item's `com.canonical.dbusmenu` menu, read again on each change, with `click` and `aboutToShow`. Hidden entries are left out; labels lose their mnemonic underscore, and `mnemonic` says where it was. `icon-data` comes as a PNG `data:` URL. See [SYSTEM-TRAY.md](/docs/architecture/SYSTEM-TRAY.md). |
| `./system` | `system(domicile)`: files, watches, processes and D-Bus. Calls resolve a `Result`; the compositor refuses most while the desktop is locked. See [SHELL-SYSTEM-ACCESS.md](/docs/SHELL-SYSTEM-ACCESS.md). |
| `./portal` | `watchPortalRequests` and `answerPortalRequest`: application dialogs from `xdg-desktop-portal`, parsed by kind. `watchCapturing` and `stopCapturing`: running sessions that record the screen or control or capture input. `<PortalDialogs />` in component-library draws them. See [PORTALS.md](/docs/PORTALS.md). |
| `./global-shortcuts` | `fireGlobalShortcuts`: grab the chords applications hold through the GlobalShortcuts portal and report each press and release. `<PortalDialogs />` calls it. |
| `./appearance` | `watchAppearance`: the config's accent color, contrast and reduced motion, which the Settings portal also serves applications. See [SHELL-CONFIG.md](/docs/SHELL-CONFIG.md#theme). |
| `./icon-theme` | `readIconTheme(system)`: the config's `theme.icon_theme`, read from the compositor's Settings portal, or `None` for `hicolor` only. `watchIconTheme` reads it and follows `SettingChanged`. `@domicile-desktop/system-apps/app-icons` takes it. |
| `./extension`, `./tray`, `./notification`, `./theme`, `./display-transform` | Data types and Zod schemas for what the desktop holds. |

Internal, not needed by shells: `./cursor-shape`.

The compositor's JSON socket protocol lives in
[`@domicile-desktop/e2e-harness`](../e2e-harness/README.md); a page never
speaks it.

## Design

- **State is attributes with a bare `<name>changed` event**, over events that
  carry the value. The attribute is the one source of truth, and a late
  listener misses nothing (`navigator.onLine` with `online` works the same).
- **The engine holds moments** (`focusrequested`, `shortcut`) until the first
  listener of their type. Only the engine knows whether a listener exists.
- **Asks return promises.** A newer `searchFiles` rejects the older.
- **The desktop is handed to `Shell`**, not found on a global. There is no
  `navigator.domicile` or `window.domicile`; the shell's copy is the only one.
- **The engine reports the desktop's size and density**, and `<app>` routes
  its own input ([docs/ELEMENTS.md](docs/ELEMENTS.md)). Chords are resolved by
  the engine ([KEYBINDINGS.md](/docs/architecture/KEYBINDINGS.md)).
- **The SDK is types and pure helpers.** The host types are generated from the
  IDL, below.

## Generated types

`src/domicile-host.ts` is generated from the engine's WebIDL in
`packages/domicile-engine/src/third_party/blink/renderer/modules/domicile/`,
with the IDL's comments as its docs. Do not edit it.

```sh
bun run generate    # after changing the IDL or domicile-config
```

- `codegen/` holds the generator: a parser for the IDL subset the engine uses,
  and the TypeScript it emits. It throws on syntax outside that subset.
- `EVENT_TYPES` in `codegen/generate-domicile-host.ts` names the event type
  each `on<name>` handler dispatches, which WebIDL cannot express.
- `scripts/test-host-types-match-the-idl.sh` fails when the file is stale.

`config.schema.json` is the JSON Schema `schemars` derives from
`domicile-config`'s Rust types, and `src/config.ts` is generated from it, with
the Rust doc comments as its docs. `bun run generate` writes both and needs
`cargo`.

- `codegen/json-schema.ts` parses the schema subset `schemars` emits. It
  throws on a keyword outside it.
- `scripts/test-config-types-match-the-schema.sh` fails when either file is
  stale.

## Dependencies

- `zod` only. Its schemas parse the keywords and rows a newer engine may send
  unknown values for, such as `./cursor-shape`.
- `@cprussin/option-result` gives `./system`'s calls their `Result`.

## Test

```sh
bun run turbo test --filter @domicile-desktop/sdk
```

- React's dev build logs an unknown-tag warning for `<app>` in a shell's tests
  only.
