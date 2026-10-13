# Settings

Every desktop has a Settings app. `domicile-settings`, or **Settings** in the
launcher, opens it in an app window. It is an app module
([APP-MODULES.md](architecture/APP-MODULES.md)), not an extension, so it is
not in the Extensions page or any extension list.

- **Config pages:** Appearance, Keyboard, Displays, Power & lock, Privacy,
  Launcher and Startup cover every key of the config
  ([SHELL-CONFIG.md](SHELL-CONFIG.md)). A change is written to the file as soon
  as it is made, and the desktop reloads it.
- **Extensions:** switch an extension on or off and open its options through
  the engine. Load an unpacked folder, picked in the desktop's file
  chooser, or uninstall an extension the config did not install, through the
  engine; this works with a read-only config. The config's own uninstall by
  editing its `extensions` lists
  ([EXTENSIONS.md](architecture/EXTENSIONS.md#from-the-settings-app)).
- **Site permissions:** each permission with the sites that have a setting of
  their own for it, or each site with all its permissions. **Remove site**
  clears all of a site's own settings. Changes take effect at once in open
  browser windows. An installed extension shows by its name.
- **Camera and microphone device:** under Camera and Microphone, the device a
  site gets when it does not ask for a particular one. A site that names a
  device still gets that device. Manganese's address bar site permissions panel picks
  the same device.
- **Code:** the config file and the shell's source in a plain text editor
  (line numbers, Tab indents, Enter keeps indentation, Ctrl+S saves).
- Source and design: [`packages/app-settings`](/packages/app-settings/README.md).

## What can be changed

| The desktop's | Config pages | Code |
|---|---|---|
| JSON config, writable | edit | edit |
| JSON config, read-only (for example, home-manager's link into the Nix store) | show | show |
| Module config (`.ts`, `.js`) | show the JSON it evaluated to | edit |
| No config file | show the defaults | nothing to show |
| Shell that is a file | | edit, or show if read-only |
| Shell that is a package | | nothing to show |

- A read-only page says why above its settings.
- The host refuses a JSON config the compositor would refuse, with the
  compositor's reason. The file is not written.
- An edit made elsewhere shows at once: the host watches both files.
- `startup` is read only at startup.

## How it works

```
Settings page ─ spawn, stdio ─▶ domicile-settings-host ─ DOMICILE_SOCK ─▶ domicile ─ command socket ─▶ engine
 (app module)                       reads and writes the files    settings_files,                site_permissions,
                                                                     site_permissions,              set_site_permission,
                                                                     extensions,                    load_unpacked,
                                                                     media_devices                  uninstall_extension,
                                                                                                    config_extensions,
                                                                                                    extensions,
                                                                                                    set_extension_enabled,
                                                                                                    media_devices,
                                                                                                    set_media_device
```

| Part | Where |
|---|---|
| The app | `settings.js`, an app module in `libexec/domicile/app-modules/settings`. `DOMICILE_APP_MODULES` names another directory of app modules. |
| The host | `domicile-settings-host`, beside `domicile`. The app spawns it with the system API and frames each message as a 4-byte little-endian length and UTF-8 JSON. Protocol: `domicile_launch::settings`. |
| Finding the host | `domicile` links it into the apps' `PATH` (the runtime's `bin`, beside `xdg-open`). |
| Which files | The host asks the desktop (`settings_files` on the control socket) on every request. The page never names a path. |
| Writable | `access(W_OK)` on the file, following links. |
| Extensions | The engine's `extensions`, `set_extension_enabled`, `load_unpacked`, `uninstall_extension` and `config_extensions` commands. |
| Picking a folder | The host calls the `FileChooser` portal's `OpenFile` with `directory`, which the shell draws ([PORTALS.md](PORTALS.md)). A page cannot learn the path of a folder from `<input type="file">`. |
| Site permissions | The engine's `site_permissions` and `set_site_permission` commands ([CONTROL-CHANNEL.md](/packages/domicile-engine/docs/CONTROL-CHANNEL.md#command-socket)). They read and write the shell profile's content settings as the address bar's panel does. |
| Camera and microphone | The engine's `media_devices` and `set_media_device` commands. They read and write Chrome's device ranking in the shell profile's prefs, which Chrome uses for a site that names no device. |
| Opening it | `domicile-settings` runs `domicile run-app` on `settings.js`. |

## Key decisions

- **A spawned host over a new engine binding.** An app reaches a native
  program through the system API, so files need no engine change. Domicile's
  state that only the engine holds is an engine command
  ([APP-MODULES.md](architecture/APP-MODULES.md#domiciles-own-state)).
- **The host asks the desktop for paths.** Only `domicile` knows which config
  and shell it runs. A page that named a path could write anywhere.
- **Writes in place.** A link stays a link, so a config linked from a dotfiles
  repository keeps its link.
- **The form edits the JSON, not a model of it.** Each change sets one key and
  keeps every other, so keys the app does not know survive. Setting a value
  back to its default removes the key.
- **A module config is read-only in the form.** Its settings are code. The Code
  page edits it.
- **Writing the config is trusting the page.** The config can run commands at
  startup. Any app can spawn the host, as it can any program; only the shell
  and the config, which the user already trusts, are written.

## Shell options

The shell is code, so the form cannot edit its options. A design for options a
shell declares and the form edits is in
[SHELL-OPTIONS.md](architecture/SHELL-OPTIONS.md).
