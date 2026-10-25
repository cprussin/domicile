# Web apps

A web app on Domicile is a URL and a desktop entry. `domicile open-app <url>`
opens it in an app window: a browser window the shell draws as an application,
with no address bar while its page is on the app's origin. Domicile already is
a browser, so an app ships no browser of its own, as an Electron app does.

## Design

```
Exec=domicile open-app <url>
  ─▶ supervisor   {"type":"open_app","url":…}                     control socket
  ─▶ engine       {"type":"open_url","version":1,"url":…,"app":true}  command socket
  ─▶ shell        DomicileBrowserWindow.isApp                     browserwindowschanged
  ─▶ manganese    <BrowserWindow isApp>: no address bar on the app's origin
```

A shell's own launcher calls `domicile.browser.openApp(url)` instead, which
opens the same window over the shell's `BrowserWindows` pipe
([SHELL-BROWSER-WINDOWS.md](/docs/SHELL-BROWSER-WINDOWS.md)).

- **An app window** is a browser window with `isApp` set. It shares the
  profile, extensions and site permissions of every other window. Its visits
  stay out of the history ([HISTORY.md](/docs/HISTORY.md)).
- **Its page's new windows** (`target="_blank"`, `window.open`) are browser
  windows, as a link out of a Chrome app opens in the browser.
- **Settings and History** are app modules, which open in app windows too
  ([APP-MODULES.md](APP-MODULES.md)).

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
The home-manager module writes one for each of `programs.domicile.webApps`
([SHELL-CONFIG.md](/docs/SHELL-CONFIG.md#home-manager)).

`domicile install-app <url>` writes one from the site's web app manifest:

- **Manifest:** the page's `<link rel="manifest">`. `name` (else
  `short_name`) is the entry's name. `start_url` (else the page) is what it
  opens, and must be on the page's origin.
- **Icon:** the manifest's SVG, else its largest PNG, as the launcher draws
  only those. Maskable-only icons are skipped. Saved to
  `$XDG_DATA_HOME/domicile/app-icons/`.
- **Entry:** `$XDG_DATA_HOME/applications/domicile-app-<host-and-path>.desktop`,
  named after the start URL, so installing again replaces it. Its path is
  printed. `X-Domicile-Installed-From` records `<url>` as given.
- **Fetching:** the `curl` on `PATH`. The desktop's `PATH` has one.

`domicile uninstall-app <url>` removes that entry and its icon, without the
network:

- **`<url>`** is the address given to `install-app`, or the start URL (the
  address after `domicile open-app` in the entry). Entries installed before
  `X-Domicile-Installed-From` existed take only the start URL.
- **Found by:** the file name from `<url>` as a start URL; else each
  `domicile-app-*.desktop` whose `X-Domicile-Installed-From` is `<url>`.
- **Removed:** only those `<stem>.desktop` and `<stem>.{png,svg}` in the two
  directories above. Each path is printed.
- **Nothing there** exits non-zero, naming the URL.

An app that needs the system (files, native programs, D-Bus) is an app
module, as Settings is ([APP-MODULES.md](APP-MODULES.md)): its desktop entry
runs `domicile run-app <entry.js>`.

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
- **`install-app` fetches with `curl` over an HTTP crate.** The desktop already
  ships `curl` for bookmark icons, and an HTTP and TLS stack would be a new
  dependency for one verb.
- **`install-app`'s entry runs `domicile` from `PATH`.** A store path would
  break once garbage-collected; home-manager's entries name one because each
  generation rewrites them.
- **Every `open-app` opens a window.** An app can have several windows, as a
  browser can.
- **A read-only address off the app's origin, none on it.** Only a program the
  user runs opens an app window, so its own pages need no address. A page
  elsewhere, such as a sign-in, shows its site and connection, as Chrome does
  for an installed app.
- **The origin is the one the window opened at.** The engine lists the page's
  current address, so manganese keeps the first one it sees.

## Plan

- [x] app windows: `domicile open-app`, `isApp`, manganese draws no address
  bar
- [x] off the app's origin, show a read-only address bar, as Chrome does for an
  installed app
- [x] `domicile install-app <url>`: read the site's web app manifest (`name`,
  `icons`, `start_url`) and write a desktop entry to
  `~/.local/share/applications`
- [x] home-manager `webApps.<name> = { url; icon; }`, which writes desktop
  entries
- [x] `DomicileHost.openAppWindow(url)`, for a shell's own launcher

## Open questions

- **A profile per app?** Recommendation: no. Share the profile, as Chrome's
  installed apps do, so signing in once signs in everywhere.
