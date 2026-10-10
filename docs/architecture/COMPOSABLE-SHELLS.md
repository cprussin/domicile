# Composable shells

Users build their desktop by composing web modules in one config file.
`domicile` builds the shell from that file. The user runs no build of their own.

```tsx
// ~/.config/domicile/domicile.tsx
import {
  Battery, Brightness, Clock, DEFAULT_KEYBINDINGS, Notifications,
  ThemeSelector, Tray, WorkspaceSwitcher, focus, runManganese,
} from "@domicile-desktop/manganese";
import { GmailCount } from "./gmail-count";

export const output = { displays: [{ name: "eDP-1", scale: 2 }] };
export const extensions = { web_store: ["ddkjiahejlhfcafbddmgiahcphecmpfh"] };

export const Shell = runManganese({
  keybindings: {
    keybindings: { ...DEFAULT_KEYBINDINGS, "Meta+n": focus("right") },
  },
  topBar: {
    left: [<Tray key="tray" />, <WorkspaceSwitcher key="workspaces" />],
    middle: [<Clock key="clock" />],
    right: [
      <GmailCount account="me@gmail.com" key="mail" />,
      <ThemeSelector key="theme" />, <Brightness key="brightness" />,
      <Battery key="battery" />, <Notifications key="notifications" />,
    ],
  },
});
```

The stock shell needs no JavaScript:

```json
{
  "output": { "displays": [{ "name": "eDP-1", "scale": 2 }] },
  "extensions": { "web_store": ["ddkjiahejlhfcafbddmgiahcphecmpfh"] },
  "shell": "@domicile-desktop/manganese"
}
```

## Problem

- Customizing manganese beyond its keys requires writing a whole shell: a
  package, a vite config, a Panda setup and a build.
- Shell options in the config are untyped JSON.

## Design

### The `Shell` contract

A shell module is any module that exports `Shell`:

```ts
// @domicile-desktop/sdk/shell
export type Shell = (root: HTMLElement) => void;
```

- Only `Shell` is read. Other exports are ignored, so `load-shell` of a config
  file does not reconfigure the compositor.
- Importing the module must do nothing except install its stylesheet. The
  supervisor imports the config under Bun, which has no DOM. `Shell(root)` does
  all DOM work.
- The contract is framework-agnostic. `runManganese` is the React adapter.

The engine's shell document runs `await import("./shell.js")` and calls
`Shell(document.body)`. It shows an error on screen if the module fails to
load, has no `Shell`, or `Shell` throws.

### Shell specifiers

`domicile <shell>`, `domicile load-shell <shell>` and the JSON config's `shell`
accept the same specifiers:

| Specifier | Example | Result |
|---|---|---|
| bundle | `/path/to/bundle.js` | Served as-is. A bundle is a `.js` with no bare imports (`Bun.Transpiler.scanImports`) |
| entry | `./entry.ts`, `./entry.js` | Built |
| Domicile package | `@domicile-desktop/manganese` | The prebuilt bundle from Domicile's install. No subprocess or network |
| npm package | `my-cool-shell` | Installed into the cache. Served as-is if `package.json` has `"domicile": { "shell": "dist/shell.js" }`, else built |
| GitHub repo | `github:cprussin/my-cool-shell#v1` | Same as an npm package |

- Relative paths resolve from the working directory, or from the config file.
- The client resolves and builds before using the command socket (per
  THE-DOMICILE-BINARY.md). `load_shell`'s `root` and `module` point at the
  build output. The wire protocol is unchanged.

### The builder

`packages/domicile-builder` is a Bun program in Domicile's closure. `domicile`
spawns it. The supervisor makes decisions; the builder only builds.

| Step | Does |
|---|---|
| resolve | Uses the nearest `package.json` above the entry, or creates one beside it. Adds missing bare imports (`bun add`) |
| install | `bun install --ignore-scripts`, writing `bun.lock` beside that `package.json`. Frozen when nothing was added |
| alias | Resolves `@domicile-desktop/*`, `react` and `react-dom` to Domicile's install, whatever `package.json` says |
| style | Runs Panda over manganese's config plus the user's files, so user `css()` calls work. Inlines one stylesheet into the bundle |
| bundle | vite via `shellBuild`, to `$XDG_CACHE_HOME/domicile/shells/<hash>/shell.js` |

- **Cache key:** hash of the entry's local import graph, the lockfile and
  Domicile's version. A cache hit spawns nothing.
- **Progress:** the builder prints JSON lines
  (`{"step":"install","done":12,"total":40}`). `domicile` draws a progress bar
  on a TTY and plain lines elsewhere.
- **First start:** a build that finishes within 500 ms runs before anything
  starts. A slower one continues behind the splash (`packages/shell-splash`),
  which `domicile` replaces with the built shell. `domicile load-shell` and
  reloads never show it.
- **Failure:** on first start, a fast build's error is printed and `domicile`
  exits. A slow build's error stays on the splash, and any key logs out. On a
  running desktop, the last good build stays loaded and the error is posted as
  a notification.

### The config

`$XDG_CONFIG_HOME/domicile/domicile.{ts,tsx,js,mjs,json}`. More than one is an
error.

| Export (TS) / key (JSON) | Read by |
|---|---|
| `output`, `extensions`, `input`, `idle`, `lock`, `theme`, `files`, `startup` | Compositor and engine, per `domicile-config`'s schema |
| `Shell` (TS) / `shell` (JSON) | `domicile`, when not given a shell. A JSON `shell` is relative to the config |
| `keybindings`, `modes`, `shells`, `applications` | Rejected. These are shell props |

- **TS evaluation:** the builder (`--evaluate`) bundles the config for Bun,
  with `@domicile-desktop/*` and React from the install and stylesheets
  stubbed. It imports it and writes every export but `Shell` to
  `$XDG_CACHE_HOME/domicile/shells/configs/<key>.json`. `domicile` copies that
  file to `<runtime>/config.json`, the path the compositor is given and
  watches. The compositor only parses JSON (`domicile-config`). It never runs
  JavaScript.
- **Types:** `schemars` emits a JSON Schema from the Rust types. It serves as
  the JSON config's `$schema`, and the `@domicile-desktop/sdk/config` TS types
  are generated from it.
- **Reload:** `domicile` watches a module config's directory.
  - It skips `node_modules` and dot directories.
  - On an edit, it re-evaluates the config into `<runtime>/config.json`.
  - If the config is also the shell, it rebuilds and reloads the shell.
  - On failure, it logs to stderr, sends a critical notification and leaves
    the desktop unchanged.

### Keybindings belong to the shell

```ts
runManganese({
  keybindings: {
    keybindings: { ...DEFAULT_KEYBINDINGS, "Meta+r": mode("resize") },
    modes: { resize: { "Meta+l": grow("right"), "Meta+Escape": mode("default") } },
  },
});
```

- A binding maps a chord to a typed command from the shell's package
  (`focus("right")`, `workspace("3")`).
- `shell_config` carries `keys`: each keysym the keyboard can type and its
  evdev key (`Keyboard::keys`, same rule as `key_for`). The engine resolves
  the chords `bindKeys` grabs against it on each config, so layout changes
  move them.
- Manganese ships sway's bindings on Meta (`DEFAULT_KEYBINDINGS`,
  `DEFAULT_MODES`), so the JSON config has keys.

### `@domicile-desktop/manganese` is a library

| Export | Purpose |
|---|---|
| `runManganese(options): Shell` | Mounts manganese into `root` |
| `Launcher`, `Tray`, `WorkspaceSwitcher`, `Clock`, `Mode`, `ThemeSelector`, `Volume`, `Brightness`, `Battery`, `Notifications` | Bar items. Each reads its bar from context |
| `DEFAULT_TOP_BAR`, `TopBarLayout` | The default bar and its type |
| `focus`, `move`, `workspace`, `grow`, `mode`, `exec`, … | Commands for bindings |
| `DEFAULT_KEYBINDINGS`, `DEFAULT_MODES` | Sway's bindings on Meta, the default |
| `Shell` | `runManganese({})`, loaded by `"shell": "@domicile-desktop/manganese"` |

User widgets style themselves with `@domicile-desktop/component-library`. They
can call Panda `css()` from `@domicile-desktop/manganese/css` (also `/jsx`,
`/patterns`, `/tokens`). They notify with `new Notification()`. Web Notifications reach the compositor's
notification server, and manganese shows them as toasts.

### Published packages

- `@domicile-desktop/sdk`, `@domicile-desktop/component-library` and
  `@domicile-desktop/manganese` are on npm.
- Each merge to main publishes `0.0.0-alpha-<sha>` as `latest`
  (`publish-packages.yml`) via npm trusted publishing: no token, with
  provenance. Alphas publish as `latest` so `npm install @domicile-desktop/sdk`
  gets the newest build.
- No semver until there is a release.
- The published copies serve editors and third-party shells. A build always
  aliases them to the running Domicile's copies.

## Key decisions

- **Compositor settings stay outside the shell.** Displays and extensions
  apply before any page exists, and a broken shell must not lose the monitors.
  One file holds both, and each consumer reads its own exports.
- **Keybindings in the shell, not the config.** They name the shell's
  commands, and TypeScript types them. Cost: a shell that fails to load has no
  keys. Recover with `domicile load-shell` from another VT or ssh.
- **Domicile builds the shell.** Users should not need a build toolchain. The
  supervisor only spawns the builder; the builder owns the bundler.
- **Bun installs and runs; vite bundles.** Bun writes the lockfile, installs,
  and runs the builder and the TS config. vite bundles because `shellBuild` and
  Panda's postcss plugin already produce a shell module with its CSS inlined,
  so users get the same build manganese ships.
- **`@domicile-desktop/*` and React come from the install.** Two copies of
  React break hooks, and a mismatched SDK speaks a different protocol. A
  user's `package.json` cannot choose another React version.
- **No fallback shell during the first build.** A desktop running a shell the
  user did not configure looks correct but is wrong. Startup shows the splash
  instead, which has no keys and no windows.
- **home-manager builds a TS config with `bun2nix`.** The module takes a
  directory holding the config and its `bun.lock`. JSON stays the default.
- **"Desk" is not a user-facing name.** No export, config key or CLI word uses
  it.

## Plan

Done:

- [x] Phase 1: `Shell` contract and keybindings as props
- [x] Phase 2: `domicile` builds shells (`packages/domicile-builder`)
- [x] Phase 3: JSON and TS config, config watch and reload
- [x] Phase 4: packages published to npm
- [x] `schemars` schema and generated `@domicile-desktop/sdk/config` types

Open:

- [ ] `nix/home-manager.nix` builds a TS config directory with `bun2nix`
