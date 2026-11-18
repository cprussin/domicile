# Release notes

What's new for shells and apps built on Domicile, in each release. What's new
in the manganese desktop is in
[manganese's release notes](use/RELEASE-NOTES.md).

## 1.3.0

_Unreleased_

### Electron apps on the engine

![Element on the engine, its menu bar drawn by the shell](media/release-electron.png)

Listed Electron apps run on the desktop's engine. Their windows, views, menu bars and message boxes reach your shell to lay out and draw. A page that asks for Node.js (`nodeIntegration`, or a preload that isn't sandboxed) gets it, in a renderer of its own.

[Design](architecture/ELECTRON-APPS.md) · [`electron.apps`](SHELL-CONFIG.md) · [#2091](https://github.com/cprussin/domicile/pull/2091) · [#2151](https://github.com/cprussin/domicile/pull/2151) · [#2161](https://github.com/cprussin/domicile/pull/2161) · [#2172](https://github.com/cprussin/domicile/pull/2172) · [#2201](https://github.com/cprussin/domicile/pull/2201) · [#2256](https://github.com/cprussin/domicile/pull/2256)

### Browser profiles

![A page in the Work profile, and its profile menu](media/release-profiles.png)

Profiles with their own sign-ins, site data and extensions; each site opens in its own. `browser.profiles`, `profileFor()`, `reopen()`, `pin()`, `<webview profile>`.

[Design](architecture/BROWSER-PROFILES.md) · [#2212](https://github.com/cprussin/domicile/pull/2212) · [#2213](https://github.com/cprussin/domicile/pull/2213) · [#2216](https://github.com/cprussin/domicile/pull/2216) · [#2230](https://github.com/cprussin/domicile/pull/2230)

### Let agents drive the desktop

`domicile mcp` serves the Model Context Protocol, so Claude Code and other agents can list windows, open things, run shell commands, see the desk and click and type on it: `claude mcp add domicile -- domicile mcp`. `domicile pointer`, `scroll`, `key`, `type` and `screenshot --fit` do the same from scripts.

[`domicile mcp`](CLI.md#domicile-mcp)

### Script the desktop

`domicile status`, `subscribe`, `list-windows`, `list-displays`, `list-inputs`, `list-bindings`, `configure-display`, `sleep-displays`, `lock`, `focus-window` and more, like `swaymsg`.

[The domicile command](CLI.md) · [#2121](https://github.com/cprussin/domicile/pull/2121) · [#2122](https://github.com/cprussin/domicile/pull/2122) · [#2134](https://github.com/cprussin/domicile/pull/2134) · [#2136](https://github.com/cprussin/domicile/pull/2136)

### Also new

- HDR and 10-bit color: `wp_color_management_v1`, 10-bit and half-float buffers, HDR10 per display, and `Display.hdr`, `peakLuminance`, `sdrWhite`. [Design](architecture/COLOR.md) · [#1974](https://github.com/cprussin/domicile/issues/1974)
- `<app picture-in-picture>` floats a page's video as a shell window, growing from its `source`. [#2077](https://github.com/cprussin/domicile/pull/2077) · [#2177](https://github.com/cprussin/domicile/pull/2177)
- `<webview>.history()` for a Back and Forward history menu. [#2251](https://github.com/cprussin/domicile/pull/2251)
- Pointer lock, confinement and relative motion. [#2054](https://github.com/cprussin/domicile/pull/2054) · [#2057](https://github.com/cprussin/domicile/pull/2057) · [#2123](https://github.com/cprussin/domicile/pull/2123)
- Input methods in pages, the shell and native windows. [#2059](https://github.com/cprussin/domicile/pull/2059) · [#2062](https://github.com/cprussin/domicile/pull/2062)
- Shells and app modules are cross-origin isolated, with Web Workers. [#2182](https://github.com/cprussin/domicile/pull/2182) · [#2183](https://github.com/cprussin/domicile/pull/2183)
- CSS `zoom` on `<app>`. [#2072](https://github.com/cprussin/domicile/pull/2072)
- Modifier-tap bindings and `--inhibited` chords. [#2065](https://github.com/cprussin/domicile/pull/2065) · [#2030](https://github.com/cprussin/domicile/pull/2030)
- The shell draws "Sign in with" account choosers. [#2086](https://github.com/cprussin/domicile/pull/2086)
- `windows.bells()`, `toplevelId`, `cursorImage`, minimize and client-side move and resize. [#2025](https://github.com/cprussin/domicile/pull/2025) · [#2026](https://github.com/cprussin/domicile/pull/2026) · [#2049](https://github.com/cprussin/domicile/pull/2049) · [#2052](https://github.com/cprussin/domicile/pull/2052) · [#2074](https://github.com/cprussin/domicile/pull/2074)
- `session.idleAfter` and `session.idleBeforeBlanking`. [#2073](https://github.com/cprussin/domicile/pull/2073)
- Config: `terminal`, `input.keyboard.repeat`, display `mode`, `refresh`, `adaptive_sync`. [#2024](https://github.com/cprussin/domicile/pull/2024) · [#2031](https://github.com/cprussin/domicile/pull/2031) · [#2048](https://github.com/cprussin/domicile/pull/2048) · [#2069](https://github.com/cprussin/domicile/pull/2069)
- `@domicile-desktop/sdk/config-schema`. [#2090](https://github.com/cprussin/domicile/pull/2090)
- A Nix binary cache for `stable`. [#2217](https://github.com/cprussin/domicile/pull/2217)
- Chromium 160. [#2023](https://github.com/cprussin/domicile/pull/2023)

### Breaking changes

- `extensions.settings.<id>.private` and the SDK's `inPrivate` are gone: a private profile's extensions say what runs there. [#2237](https://github.com/cprussin/domicile/pull/2237)
- `session.idleWarnings` and `idle.warn_before_seconds` are gone: use `session.idleAfter`. [#2073](https://github.com/cprussin/domicile/pull/2073)

### Fixes

- Loud failures: software rendering, a stuck fullscreen page and a checked engine each notify and log. [#2071](https://github.com/cprussin/domicile/pull/2071) · [#2088](https://github.com/cprussin/domicile/pull/2088) · [#2051](https://github.com/cprussin/domicile/pull/2051)
- Captures the engine can't take fail at once. [#2184](https://github.com/cprussin/domicile/pull/2184)
- A renderer that answers the wrong request crashes instead of hanging. [#2215](https://github.com/cprussin/domicile/pull/2215) · [#2248](https://github.com/cprussin/domicile/pull/2248)
- No re-raster while a window animates; hidden windows don't tick the display. [#2227](https://github.com/cprussin/domicile/pull/2227) · [#2143](https://github.com/cprussin/domicile/pull/2143)
- A stuck page flip no longer freezes the desktop. [#2043](https://github.com/cprussin/domicile/pull/2043)

## 1.2.0

_November 10, 2026_

### Chrome never draws over the desktop

Prompts, pickers, tooltips and error pages are the shell's to draw, through `<webview>` events such as `domicile-prompt` and `domicile-picker`. Anything left is refused and logged.

[#1893](https://github.com/cprussin/domicile/pull/1893) · [#1895](https://github.com/cprussin/domicile/pull/1895) · [#1898](https://github.com/cprussin/domicile/pull/1898) · [#1901](https://github.com/cprussin/domicile/pull/1901) · [#1903](https://github.com/cprussin/domicile/pull/1903)

### Gestures

Bind touchpad gestures and touchscreen edge swipes beside keys, in sway's `bindgesture` grammar. Unbound ones reach the app.

[#1913](https://github.com/cprussin/domicile/pull/1913) · [#1925](https://github.com/cprussin/domicile/pull/1925) · [#1928](https://github.com/cprussin/domicile/pull/1928)

### Shells in WebAssembly

Write a shell in Rust or anything that compiles to wasm. `examples/dioxus-shell` is one.

[#1868](https://github.com/cprussin/domicile/pull/1868)

### Also new

- `wlr-gamma-control`, and night light per display. [#1921](https://github.com/cprussin/domicile/pull/1921)
- Touchpad and mouse config. [#1884](https://github.com/cprussin/domicile/pull/1884)
- Pointer hiding. [#1945](https://github.com/cprussin/domicile/pull/1945)
- Touch and pinch reach native apps. [#1911](https://github.com/cprussin/domicile/pull/1911) · [#1924](https://github.com/cprussin/domicile/pull/1924)

## 1.1.2

_November 5, 2026_

- A VMware guest with 3D composites on the GPU. [#1858](https://github.com/cprussin/domicile/pull/1858)

## 1.1.1

_November 4, 2026_

- The engine loads libpulse, so window and screen casts carry sound. [#1849](https://github.com/cprussin/domicile/pull/1849)
- App windows show when the engine's GPU falls back to the CPU. [#1854](https://github.com/cprussin/domicile/pull/1854) · [#1856](https://github.com/cprussin/domicile/pull/1856)

## 1.0.0

_November 3, 2026_

![A shell made of HTML](media/hero.png)

The first release: a Wayland compositor on a Chromium fork, where a shell is a web page.

- Native windows are `<app>` and websites `<webview>`, laid out with CSS.
- Write a shell in HTML, CSS and JavaScript, or React.
- Built in: sharing, screenshots, recording, casting, notifications, the tray, extensions, night light, monitor profiles and a lock screen.
- Packages for Debian, Ubuntu, Fedora, openSUSE, Arch and NixOS, and the SDK on npm.

[Quickstart](SHELL-QUICKSTART.md)
