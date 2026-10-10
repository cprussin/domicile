# Shell options in Settings

A shell declares the options it reads. Their values are JSON in the config,
under `shell_options`. The Settings app draws a form from the declaration, and
the shell reads the values at run time, so a change needs no rebuild.

```ts
// @domicile-desktop/manganese
import { defineOptions, option } from "@domicile-desktop/sdk/options";

export const options = defineOptions({
  clock: {
    format: option.choice("Clock format", ["24h", "12h"], "24h"),
    seconds: option.toggle("Show seconds", false),
  },
  topBar: {
    position: option.choice("Bar position", ["top", "bottom"], "top"),
  },
  gaps: option.number("Gap between windows", 8, { min: 0, max: 64 }),
});

export const Shell = runManganese(); // reads them with useShellOptions(options)
```

```json
{
  "shell": "@domicile-desktop/manganese",
  "shell_options": { "clock": { "format": "12h" }, "gaps": 4 }
}
```

## Problem

- A shell's options are arguments in code: `runManganese({ topBar: … })`.
  The Settings app can edit the file as text, not as settings.
- Rewriting code from a form breaks on anything but literals: spreads, imports,
  computed values, comments.
- TypeScript types are gone at run time, so the app cannot discover what a
  shell takes.

## Design

| Step | Where |
|---|---|
| Declare | The shell module exports `options`, built with `@domicile-desktop/sdk/options`: `toggle`, `choice`, `number`, `text`, `list` and nested groups, each with a label, a default and limits. It is plain data, so it serializes. |
| Extract | The builder already imports modules under Bun (`--evaluate`). After a build it imports the shell, writes `options` to `options.json` beside `shell.js`, and reports its path. A shell with no export has no options. |
| Store | `shell_options` is a top-level config key the compositor carries and does not read, as it does `shell`. `domicile-config` keeps it as an opaque JSON value. A TS config sets it with `export const shell_options = {…}`. |
| Deliver | The compositor adds `options` to the `shell_config` message it sends on connect and on reload. The SDK exposes it as `domicile.shellOptions` and a `shelloptionschange` event. |
| Read | `useShellOptions(options)` parses the values against the declaration: an unknown key or a bad value is dropped with a console error, and a missing one takes its default. |
| Edit | `settings_files` reports `options.json`. The Settings app's **Shell** page draws one control per option and writes `shell_options` like any other key. The host validates values against the declaration before writing. |

Arguments in code win over options: `runManganese({ topBar })` fixes the bar
whatever `shell_options` says. The form marks no option as overridden, since
it cannot see the code; the shell's docs say which arguments shadow which
options.

## Key decisions

- **Values in JSON over rewriting code.** A JSON key can be written safely; a
  call's arguments cannot.
- **A declared schema over reading prop types.** Types do not exist at run
  time, and a declaration carries labels, defaults and limits a form needs.
- **Live through `shell_config` over a rebuild.** A rebuild takes seconds and
  reloads the page; a message updates the bar in place.
- **One opaque key over a section per shell.** The compositor's schema stays
  closed (`deny_unknown_fields`) and does not change when a shell adds an
  option.
- **Drop bad values in the shell, refuse them in the host.** The shell must
  start whatever the file says; the app should never write a bad value.

## Plan

- [ ] `@domicile-desktop/sdk/options`: `defineOptions`, the option kinds, their
  JSON form and a parser with tests
- [ ] `domicile-config`: an opaque `shell_options` key
- [ ] the compositor sends `options` in `shell_config`; the SDK exposes it
- [ ] the builder writes `options.json`; `settings_files` reports it
- [ ] `domicile-settings-host` validates `shell_options` writes against it
- [ ] the Settings app's Shell page draws the form
- [ ] manganese declares its options and reads them with `useShellOptions`

## Open questions

- **Options a module config computes.** A TS config that builds
  `shell_options` in code is read-only in the form, as its other settings are.
  Recommendation: accept that; JSON users get the form.
