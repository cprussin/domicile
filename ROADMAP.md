# Loom roadmap

Built test-first, from the pure-logic core outward to the hardware/engine glue.

## Phase 0 — Foundation ✅
- [x] Nix flake dev shells (core + full)
- [x] Rust workspace + architecture docs
- [x] Green `cargo test` for the pure-logic core

## Phase 1 — Pure-logic core (TDD, runs anywhere) ✅
- [x] `wc-config`: schema, parse, defaults, chrome-package resolution,
      hot-reload "keep last-good on error" semantics, file watcher
- [x] `wc-scene`: portal registry, hit-testing under CSS transforms,
      chrome-vs-app input routing, z-order
- [x] `wc-protocol`: host ↔ in-page bridge messages, versioning, round-trip

## Phase 2 — AppTextureBridge spike (needs `.#full` + GPU)
The load-bearing risk. Goal: **one** Wayland client rendered inside the page
as a CSS-styled (rounded + blurred + rotated) `<app>` element.
- [ ] Embed prebuilt CEF, off-screen render the page to a GPU texture
- [ ] Import a client dmabuf as a texture usable by the page (zero-copy target)
- [ ] Round-trip input to that client with transform-correct coordinates

## Phase 3 — Wayland host (`wc-host`, Smithay)
- [x] Host orchestrator brain (app lifecycle, placement, input routing) — TDD
- [x] Host <-> chrome IPC seam (newline-JSON, handshake) — TDD, real socket
- [x] `loom` daemon: boots from config, serves the chrome protocol (control
      plane) — TDD, real end-to-end binary test
- [x] `wc-compositor`: headless Smithay Wayland server (compositor + shm +
      xdg-shell + seat + output) — runs; maps toplevel/destroy onto
      `Host::app_appeared`/`app_closed`
- [x] Unified process: compositor also serves the chrome protocol socket and
      shares one `Host`; app lifecycle broadcast to connected chrome
- [x] **End-to-end prototype**: real Wayland client → compositor → host → chrome
      proven headlessly (`scripts/e2e-chrome.sh`); Electron chrome window shows
      a styled `<app>` portal (`scripts/run-prototype.sh`)
- [ ] Export client surfaces (dmabuf) to the web engine (AppTextureBridge)
- [ ] Present the engine's composited frame — replaces the `<app>` placeholder
      with real pixels (needs the CEF bridge + a display; see docs/CEF-SPIKE.md)
- [ ] DRM/KMS backend for real hardware

## Phase 4 — Chrome SDK + simple shell (mostly done)
- [x] `chrome-sdk`: `<loom-app>` / `<loom-webview>` custom elements + bridge
      client + affine matrix helpers (TDD, 22 tests)
- [x] `shells/simple`: minimal reference chrome (a bar + a stage mounting app
      portals), with `ShellController` app lifecycle (TDD, 5 tests)
- [ ] Engine aliasing of bare `<app>` / `<webview>` tag names
- [ ] Hot-swap the active shell via config with no restart

## Phase 5 — Hardening
- [ ] Multi-output, HiDPI, damage tracking, security/sandbox review
