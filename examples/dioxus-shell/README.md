# dioxus-shell

The shell from [SHELL-QUICKSTART.md](/docs/SHELL-QUICKSTART.md), in Rust with
[Dioxus](https://dioxuslabs.com), compiled to WebAssembly:

- Every window side by side, the focused one outlined.
- A box at the bottom that runs the command typed in it, such as `firefox`.
- Meta+Enter opens `kitty`.

## Files

- `src/lib.rs`: the shell. `Shell` is exported to JavaScript with
  `#[wasm_bindgen(js_name = Shell)]`.
- `src/domicile.rs`: `wasm-bindgen` bindings for the parts of `domicile` the
  shell uses. Add a binding for each member you need; the types are in
  `@domicile-desktop/sdk`.
- `shell.js`: loads the wasm, then re-exports `Shell`. Domicile calls `Shell`
  as soon as the module loads, so the wasm must be ready first.

## Build and run

Domicile's builder only bundles JavaScript, so build this yourself. Needs the
`wasm32-unknown-unknown` target and `wasm-bindgen-cli` at the version
`Cargo.toml` pins.

```sh
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target web --no-typescript --out-dir dist/pkg \
  target/wasm32-unknown-unknown/release/dioxus_shell.wasm
cp shell.js dist/
domicile ./dist/shell.js
```

Or run it with Nix, from anywhere. Inside a desktop, it opens nested:

```sh
nix run github:cprussin/domicile#dioxus-shell-example
```

## Notes

- `<app>` is not an HTML element Dioxus knows, so `lib.rs` adds it to
  `dioxus_elements`.
- Desktop events arrive outside Dioxus. `use_windows` sends them through a
  channel to a future that updates a signal.
- It is its own cargo workspace, so Dioxus stays out of Domicile's
  `Cargo.lock`. The flake's `dioxus-shell-example` check builds it.
