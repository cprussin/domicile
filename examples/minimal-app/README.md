# minimal-app

The smallest Domicile app module: it lists the files in your home directory.
See [APP-MODULES.md](/docs/architecture/APP-MODULES.md).

- `home.js` exports `main`, which Domicile calls with the window's root
  element and the app's host. That file is the whole app.
- It calls the system with the host directly. An app built with the SDK passes
  the host to `system()` from `@domicile-desktop/sdk/system` instead, and
  types `main` with `AppMain` from `@domicile-desktop/sdk/app`.

## Run

Inside a running desktop:

```sh
domicile run-app ./home.js
```

Each run opens another window. The app's address and storage come from this
directory, so a copy elsewhere is a different app.
