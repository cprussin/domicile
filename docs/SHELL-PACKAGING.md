# Packaging a shell

How to build a shell into one module and ship it. Part of
[WRITING-A-SHELL.md](WRITING-A-SHELL.md).

## Bundling

Build one module with a fixed name:

```ts
// vite.config.ts
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: "src/index.ts",
      output: { entryFileNames: "shell.js" },
      preserveEntrySignatures: "exports-only",
    },
  },
});
```

`outDir` is up to you. The other four settings are required, and each fails
silently without it:

- **`input`:** a `.ts` file, so no HTML document is emitted.
- **`entryFileNames`:** fixed. Vite hashes it by default, and the path is what
  users pass to `domicile`.
- **`preserveEntrySignatures: "exports-only"`:** keeps the `Shell` export. An
  app build drops it, along with all code only it reaches.
- **`base: "./"`:** makes emitted URLs relative to Domicile's document.

Other rules:

- **CSS:** inline it into the bundle. Vite extracts imported CSS into a
  separate file for a `<link>`, and Domicile's document has none. Use a
  `generateBundle` plugin; this repo's is
  [`@domicile-desktop/component-library/vite-shell`](/packages/component-library/src/vite-shell.ts).
- **Dependencies:** the bundle must contain everything. Nothing resolves at
  run time and there is no `node_modules`. Vite's browser build does this by
  default.
- **Theme flash:** nothing paints before your code runs, and the theme
  arrives a few milliseconds after connecting. Either paint in a default theme
  and switch on the first `theme` message, or paint in the last theme you saw
  (manganese does this) and correct on the first message.

## Distributing

A shell is a directory containing a module:

```
my-desktop/
  dist/
    shell.js
```

Ship it any way (tarball, git checkout, Nix derivation) and pass the module
path:

```sh
nix run github:cprussin/domicile/stable -- ./my-desktop/dist/shell.js
```

- Pass the module, not the directory. A directory is refused.
- Files next to the module are served. Nothing above its directory is.

`domicile` can also build a shell from source:

```sh
domicile ./my-desktop/src/index.ts       # an entry file
domicile my-cool-shell                   # an npm package
domicile github:me/my-cool-shell         # a repository
domicile @domicile-desktop/manganese     # Domicile's own, prebuilt
```

- An entry's packages go in the nearest `package.json` and `bun.lock` above
  it, created next to it if there are none.
- `@domicile-desktop/*` and React always come from the running Domicile.
- A package with a prebuilt module declares it in `package.json` as
  `"domicile": { "shell": "dist/shell.js" }` and is served as is. Otherwise it
  is built from its entry.
- Builds are cached under `$XDG_CACHE_HOME/domicile/shells`.

Users of your shell never run `domicile-compositor` and do not need a config
file.
