# Build an app

An app on Domicile is web code in an app window: no address bar, its own
icon in the launcher, and a window that tiles like any other. There are two
kinds.

| | A web app | An app module |
|---|---|---|
| Is | A website | A JavaScript module on the machine |
| Reaches | What any site does | Files, processes and D-Bus too |
| Ships as | A URL | A directory, and a desktop entry |
| Examples | Any site with a manifest | Domicile's Settings and History |

## A web app

Any site is an app already:

```sh
domicile open --app https://excalidraw.com/      # open it once
domicile install-app https://excalidraw.com/     # add it to the launcher
```

`install-app` names and draws it from the site's
[web app manifest](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest).
It shares the browser's profile, extensions and site permissions. Links that
leave its site open in a browser window. Design:
[WEB-APPS.md](architecture/WEB-APPS.md).

## An app module

An app module exports `main`, which Domicile calls with an element to draw in
and the desktop, as it calls a shell's `Shell`. With React, `mount` is a
`main`; in plain JavaScript, `main` draws into the element itself:

<!-- tab: React -->

```tsx
// src/main.tsx: a note, kept in ~/notes.txt.
import { useAppDomicile } from "@domicile-desktop/react/domicile-provider";
import { mount } from "@domicile-desktop/react/mount";
import { useEffect, useState } from "react";

const PATH = "notes.txt";

const Notes = () => {
  const { files } = useAppDomicile();
  const [text, setText] = useState<string | undefined>(undefined);

  useEffect(() => {
    files.readText(PATH).then(
      (read) => setText(read.unwrapOr("")),
      (error: unknown) => console.error(error),
    );
  }, [files]);

  return text === undefined ? null : (
    <textarea
      defaultValue={text}
      onBlur={(event) => {
        files.write(PATH, event.currentTarget.value).catch(console.error);
      }}
      style={{ blockSize: "100vh", inlineSize: "100%" }}
    />
  );
};

export const main = mount(Notes);
```

<!-- tab: JavaScript -->

```js
// src/main.js: a note, kept in ~/notes.txt.
const PATH = "notes.txt";

export const main = async (root, domicile) => {
  const read = await domicile.files.readText(PATH);
  const text = document.createElement("textarea");
  text.value = read.unwrapOr("");
  text.style.cssText = "block-size: 100vh; inline-size: 100%";
  text.addEventListener("blur", () => {
    domicile.files.write(PATH, text.value).catch(console.error);
  });
  root.append(text);
};
```

<!-- /tabs -->

- `useAppDomicile()`, or `main`'s second argument, is what the app may use:
  `files`, `processes` and `dbus`
  ([SHELL-SYSTEM-ACCESS.md](SHELL-SYSTEM-ACCESS.md)). A relative path starts
  at the home folder. An app hears no desktop events and cannot
  touch windows, input or the lock.
- Each call answers a `Result`: `Ok` with the answer, `Err` with why.
- `prefers-color-scheme` and `prefers-reduced-motion` follow the desktop.

### Build it

Build one module, as a shell is built
([SHELL-PACKAGING.md](SHELL-PACKAGING.md#bundling)):

```ts
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: "src/main.tsx",
      output: { entryFileNames: "notes.js" },
      preserveEntrySignatures: "exports-only",
    },
  },
});
```

```sh
bun add @domicile-desktop/react@next @domicile-desktop/sdk@next react react-dom
bun add -d vite
bunx vite build
domicile open --app ./dist/notes.js
```

- The module's directory is the app: every file under it is served, and
  nothing outside it is.
- Its storage (`localStorage`, IndexedDB) is its own, kept by that directory.
- Several windows of one app share it. Coordinate them with
  `BroadcastChannel`.

### Ship it

Install the directory anywhere, with a desktop entry so the launcher lists
it:

```ini
[Desktop Entry]
Type=Application
Name=Notes
Icon=accessories-text-editor
Exec=domicile open --app /usr/share/notes/notes.js
```

Design and security: [APP-MODULES.md](architecture/APP-MODULES.md).
