# site-switcher-extension

A Manifest V3 Chrome extension: its popup lists every open website, filters as
you type, and switches to the one you pick.

In Chrome it lists tabs. On a Domicile desktop every website window is a tab
to extensions, so it lists every website on the desktop, on any workspace.
Picking one asks the shell to show it; manganese switches to its workspace.

Install it unpacked from your config:

```json
{ "extensions": { "unpacked": ["~/src/domicile/examples/site-switcher-extension"] } }
```

Its button shows in the shell's tray. The `possible-extensions` docs media
scene records it. See [EXTENSIONS.md](/docs/architecture/EXTENSIONS.md) for
which extension APIs a desktop supports.
