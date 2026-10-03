# Composable shells

A user customizes their desktop by composing web modules. The config is a
TypeScript (or JavaScript, or JSON) file; the shell is one export of it, built
by `domicile` with no build step of the user's own.

```tsx
// ~/.config/domicile/domicile.tsx
import {
  Battery, Brightness, Clock, DEFAULT_KEYBINDINGS, Notifications,
  ThemeSelector, Tray, WorkspaceSwitcher, focus, runManganese,
} from "@domicile/manganese";
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

The same thing with the shell as shipped needs no JavaScript:

```json
{
  "output": { "displays": [{ "name": "eDP-1", "scale": 2 }] },
  "extensions": { "web_store": ["ddkjiahejlhfcafbddmgiahcphecmpfh"] },
  "shell": "@domicile/manganese"
}
```

## Problem

- Changing anything about manganese beyond its keys means writing a shell:
  a package, a vite config, a Panda setup, and a build to rerun.
- The config is TOML, and what it says to a shell is
  `[shells.<name>.options]`: untyped JSON.

## Design

### The `Shell` contract

A shell module is any module with a `Shell` export:

```ts
// @domicile/sdk/shell
export type Shell = (root: HTMLElement) => void;
```

| Rule | Why |
|---|---|
| Only `Shell` is read; every other export is ignored | One file is both the config and a shell, and `load-shell` of it must not reconfigure the compositor |
| Importing the module does nothing but install its stylesheet; `Shell(root)` does everything | The supervisor evaluates the config's other exports under Bun, with no DOM |
| Framework-agnostic | `runManganese` is React's adapter, not the contract |

The document the engine writes imports the module (`await import("./shell.js")`)
and calls `Shell(document.body)`, reporting on the screen a module that does not
load, has no `Shell`, or whose `Shell` throws.

### What `domicile load-shell` takes

The same specifiers serve `domicile <shell>`, `domicile load-shell <shell>`
and the JSON config's `shell`:

| Specifier | Example | What happens |
|---|---|---|
| a bundle | `/path/to/bundle.js` | served as-is: a `.js` whose import graph has no bare specifiers (`Bun.Transpiler.scanImports`) |
| an entry | `./entry.ts`, `./entry.js` | built |
| a package of Domicile's | `@domicile/manganese` | the prebuilt bundle in Domicile's own install. No subprocess, no network |
| an npm package | `my-cool-shell` | installed into the cache; served as-is if its `package.json` names a prebuilt bundle (`"domicile": { "shell": "dist/shell.js" }`), built otherwise |
| a GitHub repo | `github:cprussin/my-cool-shell#v1` | as an npm package |

A relative path is relative to where it was typed, or to the config file.
Resolving and building happen in the client, before the command socket
(THE-DOMICILE-BINARY.md's rule); `load_shell`'s `root` and `module` are the
build's output. The wire does not change.

### The build

`packages/domicile-builder`: a Bun program shipped in Domicile's closure,
spawned by `domicile`. The supervisor stays the one that decides; the builder
only builds.

| Step | Does |
|---|---|
| resolve | the nearest `package.json` above the entry owns its dependencies. With none, one is created beside the entry. A bare import not in it is added (`bun add`) |
| install | `bun install --ignore-scripts`, writing `bun.lock` beside that `package.json`. Frozen when nothing was added |
| alias | `@domicile/*`, and their peers `react` and `react-dom`, resolve to Domicile's install, whatever `package.json` says |
| style | Panda over manganese's own config, so manganese and the component library are styled. One stylesheet, inlined into the bundle as `vite-shell` does |
| bundle | vite, as `shellBuild` → `$XDG_CACHE_HOME/domicile/shells/<hash>/shell.js` |

- **The cache key** is the hash of the entry's local import graph, the lockfile
  and Domicile's version. A hit spawns nothing beyond the hash.
- **Progress** is JSON lines from the builder (`{"step":"install","done":12,"total":40}`),
  drawn by `domicile` as a progress bar on a TTY and as plain lines elsewhere.
  The first build blocks startup. Nothing falls back to a built-in shell.
- **A failed build** prints the builder's error and exits on first start. On a
  running desktop the last good build stays loaded, and the error is posted to
  the compositor's own notification server.

### The config

`$XDG_CONFIG_HOME/domicile/domicile.{ts,tsx,js,json}`. Two of them are refused.

| Export (TS) / key (JSON) | Read by |
|---|---|
| `output`, `extensions`, `input`, `idle`, `lock`, `theme`, `applications`, `files`, `startup` | compositor, engine: the schema TOML had, key for key |
| `Shell` (TS) / `shell` (JSON) | `domicile`, when it is given no shell; a JSON `shell` is relative to the config |
| `keybindings`, `modes`, `shells` | compositor, until they go: props of the shell |

- **TS is evaluated to JSON by the builder** (`--evaluate`): bundled for Bun
  with `@domicile/*` and React from the install and stylesheets stubbed,
  imported, every export but `Shell` written to
  `$XDG_CACHE_HOME/domicile/shells/configs/<key>.json`, which is the path the
  compositor is handed. The compositor parses JSON or TOML
  (`domicile-config`, the same structs, by extension). It never runs
  JavaScript.
- **Types come from the Rust schema**: `schemars` emits a JSON Schema, published
  for the JSON config's `$schema`, and the TS types in `@domicile/sdk/config`
  are generated from it.
- **The supervisor watches** the config and its local imports, rebuilds both
  halves, then reloads the compositor's config and runs `load-shell`. The
  compositor stops watching files.

### Keybindings are the shell's

```ts
runManganese({
  keybindings: {
    keybindings: { ...DEFAULT_KEYBINDINGS, "Meta+r": mode("resize") },
    modes: { resize: { "Meta+l": grow("right"), "Meta+Escape": mode("default") } },
  },
});
```

- A binding maps a chord to a typed command from the shell's own package
  (`focus("right")`, `workspace("3")`), not a `send-shell` string.
- `shell_config` carries `keys`: every keysym the keyboard can type and the
  evdev key it is on (`Keyboard::keys`, the same rule as `key_for`). `bindKeys`
  resolves the shell's chords against it as each config arrives, so a layout
  change moves them. No new message, and no engine change: `shell_config`
  crosses the engine as a string.
- The config's bindings sit on top until phase 3 deletes them.
- Manganese ships sway's keys on Meta (`DEFAULT_KEYBINDINGS`, `DEFAULT_MODES`),
  so the JSON config has keys.

### `@domicile/manganese` is a library

| Export | Is |
|---|---|
| `runManganese(options): Shell` | mounts manganese into `root` |
| `Launcher`, `Tray`, `WorkspaceSwitcher`, `Clock`, `Mode`, `ThemeSelector`, `Volume`, `Brightness`, `Battery`, `Notifications` | the bar's items, each reading the bar it is on from context |
| `DEFAULT_TOP_BAR`, `TopBarLayout` | manganese's own bar, and its shape |
| `focus`, `move`, `workspace`, `grow`, `mode`, `terminal`, … | the commands a binding names |
| `DEFAULT_KEYBINDINGS`, `DEFAULT_MODES` | sway's keys on Meta, what a desktop gets unasked |
| `Shell` | `runManganese({})`: what `"shell": "@domicile/manganese"` loads |

A widget of the user's own styles itself with `@domicile/component-library`
and notifies with `new Notification()`. Web Notifications already reach the
compositor's notification server, which manganese shows as toasts.

### Published packages

`@domicile/sdk` (today `@domicile/chrome-sdk`), `@domicile/component-library`,
`@domicile/manganese` (today `@domicile/shell-manganese`), on npm, versioned
with Domicile's releases. The published copies are for editors and third-party
shells. A build always aliases them to the running Domicile's.

## Key decisions

- **One file, two consumers, over a shell that carries the compositor's
  settings.** Displays and extensions apply before any page exists, and a broken
  shell must not lose the monitors.
- **Keybindings in the shell, over the config.** They mean the shell's
  commands, and in TypeScript they are typed. The cost: a shell that fails to
  load has no keys. Recover with `domicile load-shell` from a terminal reached
  some other way, such as another VT or ssh.
- **Domicile builds, over the user building.** This reverses
  THE-DOMICILE-BINARY.md's "`domicile` builds nothing" and "no watch mode".
  Those decisions kept a developer's convenience out of every user's entry
  point. Here the build *is* the user's entry point. The supervisor still only
  spawns: the bundler is the builder's.
- **Bun installs and runs; vite bundles.** Bun writes the lockfile, installs
  and runs the builder and the TS config. The bundle is vite's, because
  `shellBuild` and Panda's postcss plugin already make a shell module with its
  CSS inside, and the build a user gets is then the one manganese ships.
- **`@domicile/*` and React from the install, over the lockfile.** Two Reacts
  break hooks across the boundary, and an SDK older or newer than the
  compositor speaks a different protocol. A user's `package.json` cannot pick
  another React version.
- **No fallback during the first build.** A desktop that comes up on a shell
  the user did not configure is a wrong answer that looks right. A progress bar
  is an honest one.
- **home-manager builds a TS config with `bun2nix`.** The module takes a
  directory holding the config and its `bun.lock`; JSON stays its default.
- **No TOML converter.** TOML is deleted outright.
- **"Desk" is not a user-facing name.** Nothing exported, no config key and no
  CLI word says it.

## Plan

Phase 1: the contract, by hand.

- [x] `Shell` in `@domicile/sdk/shell`. The engine's document imports it and
      calls it, and the reporter refuses a module without one
- [x] manganese, `shell-simple`, `examples/minimal-shell` and the guards'
      fixtures export `Shell` with no import-time effects
- [x] `@domicile/manganese`: `runManganese` and the bar items exported, the
      bar's layout a prop. The commands land with keybindings
- [x] keybindings as props: `keys` in `shell_config`, `bindKeys` resolving the
      shell's own chords, manganese's commands and default bindings
- [x] check, in a guard: the shell page may show a Web Notification and reads
      a cross-origin answer from `domicile://` (`guard-shell-web-apis.sh`)

Phase 2: `domicile` builds.

- [x] `packages/domicile-builder`: resolve, install, alias, style, bundle,
      cache, progress lines
- [ ] a user's own Panda `css()`: an export of manganese's `styled-system`,
      and the user's files in the build's `include`
- [x] `shell_source` resolves every specifier above. `@domicile/*` resolves in
      Rust with no subprocess
- [x] the progress bar in `domicile`. Startup blocks on the first build
- [x] the builder and Domicile's prebuilt shells in the flake's install
      (`libexec/domicile/{builder,shells}`, `.#builder`)

Phase 3: the config.

- [ ] `schemars` schema and generated `@domicile/sdk/config` types
- [x] `domicile-config` parses JSON; `domicile` finds
      `domicile.{ts,tsx,js,mjs,json,toml}` and runs the config's shell when
      given none
- [ ] `keybindings`, `modes` and `shells` go from the config
- [x] the TS config evaluated to JSON by the builder
- [ ] the supervisor watches and reloads both halves. The compositor stops
      watching. A failure becomes a notification
- [ ] `nix/home-manager.nix` writes `domicile.json`, or builds a TS config
      directory with `bun2nix`
- [ ] TOML deleted. KEYBINDINGS.md, THE-DOMICILE-BINARY.md, WRITING-A-SHELL.md
      and RUNNING-A-DESKTOP.md describe what replaced it

Phase 4: published.

- [ ] the renames, `publishConfig`, and a release job publishing every
      `@domicile/*` package on a Domicile release
