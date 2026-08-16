{
  description = "Loom — a Wayland compositor whose renderer is a web engine";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };

      # Toolchain needed to build & test the pure-logic Rust crates
      # (wc-config, wc-scene, wc-protocol). No graphics/GPU deps required
      # for these — keeps `nix develop` fast and the test loop tight.
      coreTools = with pkgs; [
        cargo
        rustc
        rustfmt
        clippy
        rust-analyzer
        pkg-config
        # Node is needed for chrome-sdk + the chrome shells (custom elements,
        # bridge client) and their vitest suites.
        nodejs_22
      ];

      # Native libraries the Wayland host (wc-host, Smithay) and the CEF
      # bridge (wc-bridge) will need. Split out so the core shell stays
      # lean; enter with `nix develop .#full` once we start on those.
      hostLibs = with pkgs; [
        wayland
        wayland-protocols
        libxkbcommon
        libinput
        udev
        libgbm          # gbm for DRM/KMS + dmabuf
        mesa
        libGL
        seatd
        # Minimal Wayland clients for exercising the compositor in tests.
        weston
        wayland-utils
        # Electron hosts the chrome shell as a visible window for the prototype
        # (the eventual target embeds CEF; Electron gets us a testable UI now).
        electron
      ];
    in
    {
      devShells.${system} = {
        # Default shell: everything needed for the TDD pure-logic core.
        default = pkgs.mkShell {
          packages = coreTools;
          RUST_BACKTRACE = "1";
          shellHook = ''
            echo "loom dev shell (core) — cargo $(cargo --version 2>/dev/null | cut -d' ' -f2)"
          '';
        };

        # Full shell: adds Wayland/DRM/GPU libraries for wc-host + wc-bridge.
        full = pkgs.mkShell {
          packages = coreTools ++ hostLibs;
          RUST_BACKTRACE = "1";
          shellHook = ''
            echo "loom dev shell (full: +wayland +drm +gl)"
          '';
        };
      };
    };
}
