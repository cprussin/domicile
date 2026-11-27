# Settings

Every desktop has a Settings app. `domicile-settings`, or **Settings** in the
launcher, opens it in an app window. `domicile-settings <page>` opens it on a
page, by its name in kebab case: `privacy`, `site-data`, `troubleshooting`. It is an app module
([APP-MODULES.md](architecture/APP-MODULES.md)), not an extension, so it is
not in the Extensions page or any extension list.

- **Config pages:** Appearance, Keyboard, Displays, Power & lock, Privacy,
  Launcher, Startup and Shell cover every key of the config
  ([SHELL-CONFIG.md](SHELL-CONFIG.md)). A change is written to the file as soon
  as it is made, and the desktop reloads it. A config Settings cannot write
  takes [temporary changes](#temporary-changes).
- **Extensions:** every installed extension, which is installed in every
  profile, with the profiles it is on in and **Choose profiles**, which opens
  the Profiles page. An extension is switched on or off only per profile.
  Change the settings it can use, on or off: site access, local files and user
  scripts, which apply in every profile. Open its options through the engine. A
  setting the config sets changes in the config, and is locked when the config
  is read-only; the rest change through the engine
  ([EXTENSIONS.md](architecture/EXTENSIONS.md#settings)). Load an unpacked
  folder, picked in the desktop's file chooser, or uninstall an extension the
  config did not install, through the engine; this works with a read-only
  config. A folder that loads a new extension asks which profiles to turn it on
  in, with none chosen, and **Cancel** uninstalls it. The config's own
  uninstall by editing its `extensions` lists
  ([EXTENSIONS.md](architecture/EXTENSIONS.md#from-the-settings-app)).
- **Profiles:** a card per browser profile with its color, whether it is
  private, and its extension switches, and one list of the sites that open
  outside the default profile, each with its profile
  ([BROWSER-PROFILES.md](architecture/BROWSER-PROFILES.md)). **Add profile**,
  **Make default**, a color, Private and removing a profile change the config.
  An extension switch and a site added here are saved by the desktop, as the
  address bar's profile menu saves them. A switch of an extension the profile's
  `extensions` list sets changes that list in one click, or takes a
  [temporary change](#temporary-changes) when the config is read-only; a site
  the config sets changes in the config, and is locked when it is read-only. Adding a site that is
  already listed is refused, pointing at its row.
- **Agents:** **Connect from the web** (`agents.web`), which shows the
  desktop's address for agents on the web such as claude.ai, with Copy, and
  each one signed in, with **Sign out**. Then each agent connected now or
  remembered, with what it reaches and when it was last used. **Stop** ends
  its sessions; **Forget** makes a remembered agent ask again
  ([AGENTS.md](AGENTS.md)).
- **Site permissions:** each permission with the sites that have a setting of
  their own for it, or each site with all its permissions. **Remove site**
  clears all of a site's own settings. Changes take effect at once in open
  browser windows. An installed extension shows by its name.
- **Site data:** each site that stores cookies or other data on this
  computer, largest first, with its size and cookie count, and a search.
  **Remove** clears everything the site stores after a confirmation.
  History clears data by time range or for one row's site
  ([HISTORY.md](HISTORY.md)).
- **Camera and microphone device:** under Camera and Microphone, the device a
  site gets when it does not ask for a particular one. A site that names a
  device still gets that device. Manganese's address bar site permissions panel picks
  the same device.
- **Troubleshooting:** **Detailed logging**, which is
  `domicile set-log-level debug` until it is turned off or the desktop
  restarts, and **Save logs**, which is `domicile export-logs` into the
  Downloads folder (`xdg-user-dir DOWNLOAD`), with **Open Downloads**. Web
  addresses and window titles are hidden unless that switch is off
  ([LOGGING.md](LOGGING.md#reading-them)).
- **Code:** the config file and the shell's source in a plain text editor
  (line numbers, Tab indents, Enter keeps indentation, Ctrl+S saves).
- Source and design: [`packages/app-settings`](/packages/app-settings/README.md).

## What can be changed

| The desktop's | Config pages | Code |
|---|---|---|
| JSON config, writable | edit | edit |
| JSON config, read-only (for example, home-manager's link into the Nix store) | temporary changes | show |
| Module config (`.ts`, `.js`) | temporary changes over the JSON it evaluated to | edit |
| No config file | temporary changes over the defaults | nothing to show |
| Shell that is a file | | edit, or show if read-only |
| Shell that is a package | | nothing to show |

- A read-only page says why above its settings. Startup is read-only but for
  a writable JSON config: its commands run only as the desktop starts.
- The host refuses a JSON config the compositor would refuse, with the
  compositor's reason. The file is not written.
- An edit made elsewhere shows at once: the host watches both files.
- `startup` is read only at startup.
- **Shell:** a control for each option the shell declares
  ([WRITING-A-SHELL.md](WRITING-A-SHELL.md#options)), a card per group. The
  host refuses a `shell_options` value the declaration refuses, naming it. A
  value already bad in the file does not block other edits.

## Temporary changes

A config Settings cannot write still changes from its pages: the compositor
lays each change over the config until the desktop restarts.

- A change says "Changed from your config" on its row, with **Reset**. The
  page's note counts its changes, with **Reset all**.
- A change ends when the desktop stops, when it is reset, or when the file
  changes what it has at that setting. The file always wins.
- A change the config would refuse is refused, with the compositor's reason.
  If the file's next version and the changes no longer make a valid config,
  every change ends.
- Setting the file's own value ends the change.
- The lock's own settings (`lock`, its PAM service) take no temporary
  change, and a locked desktop takes only the theme toggle's. Other settings that bear on locking, such as
  `idle.lock_after_seconds`, change for now like any setting.
- The shell's theme toggle and `domicile theme` are temporary changes of
  `theme.mode`, so Settings shows them, as it shows any change a shell makes
  while it is open (`domicile-app-host` follows the compositor's
  `config-overrides` watch topic).
- A config Settings can write shows them too, with **Reset**. A choice made in
  Settings writes the file and ends the change at that setting.
- The extension switches of the Profiles page and the tray's menu take them
  for an extension the config switches, as a change of the profile's
  `extensions` list. The tray's switch is always temporary. On a config
  Settings writes, the Profiles page writes the switch into the file's own
  list, which ends the tray's other switches in that profile rather than
  writing them in, and its **Reset** puts one switch back without writing.
  The profiles themselves, extension settings, the lock's PAM service and
  Startup take no temporary change.

The compositor holds them (`ConfigStore::set_override` in `domicile-config`)
and takes them up as it takes up an edit of the file. The host asks with
`config_overrides`, `set_config_override` and `reset_config_overrides` on the
control socket, which `domicile` relays to the compositor as
`ChromeMessage::SetConfigOverride`, `ResetConfigOverrides` and
`WhichConfigOverrides`. A path is keys and list indexes; a value is JSON text,
and `null` takes the setting back to its default. Each change in an answer
carries `written` too, what the file has under it.

A shell makes them through the SDK's `domicile.config` (`setOverride`,
`resetOverrides`, `overrides`), which calls the engine's
`DomicileHost.changeConfig`. The browser checks only the request's type; the
compositor answers each, in order, on that shell's channel, which the page
hears as `configoverrides`.

## How it works

```
Settings page ─ spawn, stdio ─▶ domicile-app-host ─ DOMICILE_SOCK ─▶ domicile ─ command socket ─▶ engine
 (app module)                       reads and writes the files    settings_files,                site_permissions,
                                                                     site_permissions,              set_site_permission,
                                                                     site_privacy,
                                                                     extensions,                    load_unpacked,
                                                                     media_devices,                 uninstall_extension,
                                                                     site_data,                     config_extensions,
                                                                     monitors
                                                                                                    extensions,
                                                                                                    set_extension_enabled,
                                                                                                    browser_profiles,
                                                                                                    pin_browser_site,
                                                                                                    site_privacy,
                                                                                                    set_site_privacy,
                                                                                                    configure_extension,
                                                                                                    media_devices,
                                                                                                    set_media_device,
                                                                                                    site_data,
                                                                                                    clear_site_data

                                                    domicile ─ chrome socket ─▶ compositor
                                                                                which_monitors
```

| Part | Where |
|---|---|
| The app | `settings.js`, an app module in `libexec/domicile/app-modules/settings`. `DOMICILE_APP_MODULES` names another directory of app modules. |
| The host | `domicile-app-host`, beside `domicile`, which History also spawns ([HISTORY.md](HISTORY.md#how-it-works)). The app spawns it with the system API and frames each message as a 4-byte little-endian length and UTF-8 JSON. Protocol: `domicile_launch::app_host`. |
| Finding the host | `domicile` links it into the apps' `PATH` (the runtime's `bin`, beside `xdg-open`). |
| Which files | The host asks the desktop (`settings_files` on the control socket) on every request. The page never names a path. |
| Writable | `access(W_OK)` on the file, following links. |
| Shell options | `settings_files` names the shell's `options.json`, beside its module. The host reads it with the config and checks `shell_options` writes against it. |
| Extensions | The engine's `extensions`, `set_extension_enabled`, `configure_extension`, `load_unpacked`, `uninstall_extension` and `config_extensions` commands. |
| Profiles | The engine's `browser_profiles`, `pin_browser_site` and `set_extension_enabled` with a `profile`, on the desk's `BrowserProfileRegistry` ([BROWSER-PROFILES.md](architecture/BROWSER-PROFILES.md)). The profiles themselves are the config's `browser`. |
| Agents | The control socket's `agents`, `stop_agent` and `forget_agent`, which the compositor answers from its agent registry and `agents.json` ([AGENTS.md](AGENTS.md#design)). Agents on the web: the host reads `domicile mcp --relay`'s status from `$XDG_RUNTIME_DIR/domicile/web-agents.json` and signed-in agents from `$XDG_STATE_HOME/domicile/signed-in-agents.json`, and signs one out by dropping its refresh tokens there; a running `domicile mcp` sees the file change and drops its access tokens too. |
| Picking a folder | The host calls the `FileChooser` portal's `OpenFile` with `directory`, which the shell draws ([PORTALS.md](PORTALS.md)). A page cannot learn the path of a folder from `<input type="file">`. |
| Site permissions | The engine's `site_permissions` and `set_site_permission` commands ([CONTROL-CHANNEL.md](/packages/domicile-engine/docs/CONTROL-CHANNEL.md#command-socket)). They read and write the shell profile's content settings as the address bar's panel does. |
| Sites you changed | The engine's `site_privacy` and `set_site_privacy` commands, for the Privacy page. They read and clear each browser profile's sites with their own ad blocking or protections, which the shield in a browser window sets ([AD-BLOCKING.md](architecture/AD-BLOCKING.md)). |
| Site data | The engine's `site_data` and `clear_site_data` commands. They read and remove the shell profile's data through Chrome's `BrowsingDataModel`, as `chrome://settings/content/all` does. |
| Camera and microphone | The engine's `media_devices` and `set_media_device` commands. They read and write Chrome's device ranking in the shell profile's prefs, which Chrome uses for a site that names no device. |
| HDR per monitor | The host's `monitors` asks the compositor `which_monitors`: each lit monitor's names (output name, connector, and its EDID name with either maker spelling) and HDR state. A profile monitor whose `display` names a plugged-in monitor that can't show HDR says "Not supported" in place of its switch. A monitor that isn't plugged in keeps its switch. |
| Opening it | `domicile-settings` runs `domicile open --app` on `settings.js`, and `domicile-settings privacy` on `settings.js#privacy`. The app opens on the page its address's fragment names, and turns to the one a later `hashchange` names. |

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
