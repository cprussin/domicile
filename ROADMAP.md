# Loom roadmap

Built test-first, from the pure-logic core outward to the hardware/engine glue.

## Phase 0 — Foundation ✅ (in progress)
- [x] Nix flake dev shells (core + full)
- [x] Rust workspace + architecture docs
- [ ] Green `cargo test` for the pure-logic core

## Phase 1 — Pure-logic core (TDD, runs anywhere)
- [ ] `wc-config`: schema, parse, defaults, chrome-package resolution,
      hot-reload "keep last-good on error" semantics, file watcher
- [ ] `wc-scene`: portal registry, hit-testing under CSS transforms,
      chrome-vs-app input routing, z-order
- [ ] `wc-protocol`: host ↔ in-page bridge messages, versioning, round-trip

## Phase 2 — AppTextureBridge spike (needs `.#full` + GPU)
The load-bearing risk. Goal: **one** Wayland client rendered inside the page
as a CSS-styled (rounded + blurred + rotated) `<app>` element.
- [ ] Embed prebuilt CEF, off-screen render the page to a GPU texture
- [ ] Import a client dmabuf as a texture usable by the page (zero-copy target)
- [ ] Round-trip input to that client with transform-correct coordinates

## Phase 3 — Wayland host (`wc-host`, Smithay)
- [ ] xdg-shell, seat/input, output; nested `winit` backend for dev
- [ ] Export client surfaces to the bridge; present the engine's frame
- [ ] DRM/KMS backend for real hardware

## Phase 4 — Chrome SDK + simple shell
- [ ] `chrome-sdk`: `<app>` / `<webview>` custom elements + bridge client (TDD)
- [ ] `shells/simple`: minimal reference chrome (a bar + an app portal)
- [ ] Hot-swap the active shell via config with no restart

## Phase 5 — Hardening
- [ ] Multi-output, HiDPI, damage tracking, security/sandbox review
