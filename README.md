# Domicile

**Build your Linux desktop with web technologies. Wayland windows are DOM elements. Chromium *is* the compositor. May God have mercy on our souls.**

Arrange native apps and websites with React, JavaScript and CSS. Use packages from npm. Change your desktop without closing your windows.

**[See it in action](https://www.domicile-desktop.com/) · [Install](https://www.domicile-desktop.com/docs/install) · [Build your desktop](https://www.domicile-desktop.com/docs/shells/quickstart) · [Community](https://matrix.to/#/%23domicile:prussin.net)**

## Your desktop is a web page

An `<app>` displays a native window. A `<webview>` displays a website. You decide where they go and how they look.

Want tiling? Use CSS.

Want floating? Use CSS.

Want to rotate Kitty 17 degrees because the user has sinned? Unfortunately, use CSS.

```css
app {
  transform: rotate(17deg);
  border-radius: 12px;
  opacity: 0.9;
}
```

Native windows go directly into Chromium’s rendering system. No screenshots, canvas copies, or other cowardice.

- **Use familiar tools.** React, Tailwind, three.js, or plain JavaScript and CSS.
- **Change it live.** Load a new desktop layout while your apps keep running.
- **Work across monitors.** One page spans every screen.
- **Share the pieces.** Publish a whole desktop on npm, or just your bar, launcher or clock.
- **Keep the essentials.** Notifications, screen sharing, clipboard history, display settings and locking are provided.

[Play with the interactive examples →](https://www.domicile-desktop.com/#make)

## Start with Manganese

Ever thought Sway was great, but needed more `<div>`s? We got you.

[Manganese](https://www.domicile-desktop.com/manganese) is a ready-to-use desktop built on Domicile. It includes tiling, workspaces, a launcher, settings and the rest of the daily necessities. Websites sit alongside native apps, and Chrome extensions work in its browser windows.

Use it as it comes, change one piece, or build something entirely your own.

## Try it

[Install Domicile](https://www.domicile-desktop.com/docs/install), then run this from your current Wayland desktop:

```sh
domicile @domicile-desktop/manganese
```

It opens in a window. Close it and you’re back.

Or try it with [Nix](https://nixos.org/download):

```sh
nix run github:cprussin/domicile/stable#manganese
```

**Nix trial:** locking requires a system password-checking service that this command doesn’t install. Until you [configure it](https://www.domicile-desktop.com/docs/manganese/install#try-it-first), don’t lock the trial or suspend the machine. If it locks, close its window.

Packages are available for Debian, Ubuntu, Fedora, openSUSE and Arch, plus NixOS configuration modules. No Chromium build required; that particular penance has already been paid.

## Create your own desktop

[Follow the quickstart](https://www.domicile-desktop.com/docs/shells/quickstart) to write your desktop in a single React or JavaScript file:

```sh
domicile ./desktop.tsx
```

Edit it, then load your changes from a terminal inside Domicile:

```sh
domicile load-shell ./desktop.tsx
```

Your windows stay open. State kept only in your desktop’s page resets.

You can also [start from Manganese](https://www.domicile-desktop.com/docs/shells/from-manganese): add a bar item, replace the launcher, or take the pieces you want.

## What works?

Domicile runs on Linux. **Apps need Wayland support; X11-only apps don’t run.**

The built-in browser supports Manifest V3 Chrome extensions, with [some differences from Chrome](https://www.domicile-desktop.com/docs/manganese/browser#differences-from-chrome). Hardware coverage is still growing.

[Checked apps](https://www.domicile-desktop.com/docs/manganese/first-steps#apps-we-check) · [Known gaps](docs/KNOWN-GAPS.md) · [Troubleshooting](https://www.domicile-desktop.com/docs/manganese/gpu-and-displays)

## Under the hood

Domicile combines a Rust Wayland compositor with a patched Chromium. Your desktop code controls the layout and can access files and programs. Websites remain ordinary websites.

[Architecture](docs/architecture/ARCHITECTURE.md) · [Chromium patches](docs/architecture/ENGINE-FORK.md) · [Contributing](docs/contributing/README.md) · [Report a bug](https://github.com/cprussin/domicile/issues)

## License

[MIT](LICENSE). Modified Chromium files retain [Chromium’s licenses](packages/domicile-engine/LICENSE).

> “Your scientists were so preoccupied with whether they could, they didn’t stop to think if they should.”
