# Web apps

A web app on Domicile is a URL and a desktop entry. `domicile open-app <url>`
opens it in an app window: a browser window the shell draws as an application,
with no address bar. Domicile already is a browser, so an app ships no browser
of its own, as an Electron app does.

## Design

```
Exec=domicile open-app <url>
  ─▶ supervisor   {"type":"open_app","url":…}                     control socket
  ─▶ engine       {"type":"open_url","version":1,"url":…,"app":true}  command socket
  ─▶ shell        DomicileBrowserWindow.isApp                     browserwindowschanged
  ─▶ manganese    <BrowserWindow isApp>: no address bar
```

- **An app window** is a browser window with `isApp` set. It shares the
  profile, extensions, site permissions and history of every other window.
- **Its page's new windows** (`target="_blank"`, `window.open`) are browser
  windows, as a link out of a Chrome app opens in the browser.
- **Settings and History** open this way: `domicile-settings` and
  `domicile-history` run `domicile open-app` with their extension pages.

### Shipping an app

A site is an app once a desktop entry opens it:

```ini
[Desktop Entry]
Type=Application
Name=Music
Icon=/usr/share/icons/music.svg
Exec=domicile open-app https://music.example/
```

Launchers list it like any application ([LAUNCHER.md](/docs/LAUNCHER.md)).

An app that needs the system (files, native programs) is an unpacked MV3
extension, as Settings is ([SETTINGS.md](/docs/SETTINGS.md)): `chrome.*` APIs,
plus native messaging for anything else. The config's `extensions.unpacked`
installs it, and its desktop entry opens `chrome-extension://<id>/<page>`. A
manifest `key` pins the id.

## Key decisions

- **A flag the engine holds over a list of app URLs in the shell.** It survives
  `domicile load-shell`, every shell sees it, and a launcher need not know
  which URLs are apps.
- **An `app` key on `open_url` over a new engine command.** An engine older
  than app windows ignores the key and opens a browser window instead of
  refusing.
- **A verb (`open-app`) over a flag on `open-url`.** `domicile` verbs take no
  flags.
- **Desktop entries over a Domicile app format.** Launchers, `xdg` tools and
  home-manager already make and read them.
- **Every `open-app` opens a window.** An app can have several windows, as a
  browser can.
- **No address bar at all.** Only a program the user runs opens an app window.
  Showing the address off the app's origin is in the plan.

## Plan

- [x] app windows: `domicile open-app`, `isApp`, manganese draws no address
  bar; Settings and History open as apps
- [ ] off the app's origin, show a read-only address bar, as Chrome does for an
  installed app
- [ ] `domicile install-app <url>`: read the site's web app manifest (`name`,
  `icons`, `start_url`) and write a desktop entry to
  `~/.local/share/applications`
- [ ] home-manager `webApps.<name> = { url; icon; }`, which writes desktop
  entries
- [ ] `DomicileHost.openAppWindow(url)`, for a shell's own launcher

## Open questions

- **A profile per app?** Recommendation: no. Share the profile, as Chrome's
  installed apps do, so signing in once signs in everywhere.
