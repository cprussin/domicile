# Settings

Every desktop has a Settings app. `domicile-settings`, or **Settings** in the
launcher, opens it in an app window
([WEB-APPS.md](architecture/WEB-APPS.md)).

- **Config pages:** Appearance, Keyboard, Displays, Power & lock, Privacy,
  Launcher and Startup cover every key of the config
  ([SHELL-CONFIG.md](SHELL-CONFIG.md)). A change is written to the file as soon
  as it is made, and the desktop reloads it.
- **Extensions:** switch an extension on or off and open its options through
  `chrome.management`. Install and uninstall by editing the config's
  `extensions` lists.
- **Site permissions:** each permission with the sites that have a setting of
  their own for it, or each site with all its permissions. **Remove site**
  clears all of a site's own settings. Changes take effect at once in open
  browser windows.
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
- `lock` and `startup` are read only at startup.

## How it works

```
Settings page ─ native messaging ─▶ domicile-settings-host ─ DOMICILE_SOCK ─▶ domicile ─ command socket ─▶ engine
 (extension)                          reads and writes the files    settings_files,                site_permissions,
                                                                     site_permissions               set_site_permission
```

| Part | Where |
|---|---|
| The app | An unpacked MV3 extension with the `management` and `nativeMessaging` permissions. Its manifest `key` fixes its id, `acpgnhiblklkgbkcjgbabkcmdmchdphk`. Installed like History ([HISTORY.md](HISTORY.md#how-it-works)). |
| The host | `domicile-settings-host`, beside `domicile`. Chrome starts it for the app. Protocol: `domicile_launch::settings`. |
| Finding the host | On every start `domicile` writes `<profile>/NativeMessagingHosts/domicile.settings.json`, whose `allowed_origins` is the app alone (`domicile_launch::apps`). |
| Which files | The host asks the desktop (`settings_files` on the control socket) on every request. The page never names a path. |
| Writable | `access(W_OK)` on the file, following links. |
| Site permissions | The engine's `site_permissions` and `set_site_permission` commands ([CONTROL-CHANNEL.md](/packages/domicile-engine/docs/CONTROL-CHANNEL.md#command-socket)). They read and write the shell profile's content settings as the address bar's panel does. |
| Opening it | `domicile-settings` runs `domicile open-app chrome-extension://acpgnhiblklkgbkcjgbabkcmdmchdphk/settings.html`. |

## Key decisions

- **Native messaging over a new engine binding.** An extension page reaches a
  native program through Chrome's own API, so files need no engine change. Only
  listing site permissions needs the engine, since `chrome.contentSettings`
  cannot list them and its settings shadow the user's.
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
  startup. Only the app's id may start the host, and only the shell and the
  config, which the user already trusts, are written.

## Shell options

The shell is code, so the form cannot edit its options. A design for options a
shell declares and the form edits is in
[SHELL-OPTIONS.md](architecture/SHELL-OPTIONS.md).
