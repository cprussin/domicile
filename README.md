# Domicile

**Write a real Wayland compositor using web technologies. Wayland windows are DOM elements. Chromium *is* the compositor. May God have mercy on our souls.**

> "Your scientists were so preoccupied with whether they could, they didn't stop to think if they should."

```tsx
const Shell = () => (
  <main>
    <app app-id="kitty" />
    <webview src="https://example.com" />
  </main>
);
```

A native Wayland window and a web page, siblings in the same DOM tree.

```css
main {
  display: flex;
}

app {
  transform: rotate(17deg);
  border-radius: 12px;
  opacity: 0.9;
}
```

Want tiling? Use CSS.

Want floating? Use CSS.

Want to rotate Kitty 17 degrees because the user has sinned? Unfortunately, use CSS.

Domicile embeds Wayland surfaces directly into Chromium's layer tree. No screenshots, canvas copies, or other cowardice.

[ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) ·
[ROADMAP.md](ROADMAP.md) ·
[running a desktop](docs/RUNNING-A-DESKTOP.md)

## Write a shell

A shell is a JavaScript module. You arrange the elements; Domicile handles the rest.

```sh
nix run github:cprussin/domicile -- ./dist/shell.js
```

**[WRITING-A-SHELL.md](docs/WRITING-A-SHELL.md)** has the details.
**[examples/minimal-shell](examples/minimal-shell)** is a complete shell built against the published SDK.

## Manganese

Ever thought Sway was great, but needed more `<div>`s? We got you.

```sh
nix run github:cprussin/domicile#manganese
```

Tiling, workspaces, a bar, native apps, and browser windows. No clone or Chromium build required; that particular penance has already been paid.

See [shell-manganese](packages/shell-manganese/README.md) for configuration and keys.

[shell-simple](packages/shell-simple/README.md) is the same terrible idea with fewer opinions.

## License

[MIT](LICENSE). The engine's patches edit Chromium files, which keep Chromium's licenses; see [`packages/domicile-engine/LICENSE`](packages/domicile-engine/LICENSE).
