{
  description = "Domicile — a Wayland compositor whose renderer is a web engine";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };

      # Toolchain needed to build & test the pure-logic Rust crates
      # (domicile-config, domicile-scene, domicile-protocol) and the whole
      # TypeScript workspace. No graphics/GPU deps required for these — keeps
      # `nix develop` fast and the test loop tight.
      coreTools = with pkgs; [
        cargo
        rustc
        rustfmt
        clippy
        rust-analyzer
        pkg-config
        # The TypeScript side: bun is the package manager and test runner,
        # biome the linter/formatter, turbo the task orchestrator (installed
        # from the lockfile by `bun install`). Node is pinned to match
        # package.json's `engines.node` (>=24).
        bun
        biome
        nodejs_24
      ];

      # Native libraries the Wayland host (domicile-host, Smithay) and the CEF
      # bridge (domicile-bridge) will need. Split out so the core shell stays
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
        # A terminal to launch via the demo shell's Alt+Enter keybinding.
        kitty
        # Electron hosts the chrome shell as a visible window for the prototype
        # (the eventual target embeds CEF; Electron gets us a testable UI now).
        electron
        # Xvfb lets us exercise the Electron chrome headlessly in tests
        # (provides the `Xvfb` binary used by scripts/e2e-electron.sh).
        xvfb
      ];

      # The scripts under `scripts/` each drive Domicile out of a checkout:
      # they build in-tree (cargo's `target/`, bun's `node_modules/`) and run
      # what they built. `nix run github:cprussin/domicile#<app>` has no
      # checkout — it hands the scripts the flake source read-only in the
      # store — so each app below stages that source in the user's cache and
      # runs the script there, inside the full shell, exactly as the
      # checkout-based commands in the README do. The staging dir is keyed by
      # the source's store path, so re-running one revision reuses its build
      # artifacts and a new revision never inherits stale ones.
      runInFullShell = name: script:
        pkgs.writeShellApplication {
          name = "domicile-${name}";
          runtimeInputs = [ pkgs.nix ];
          text = ''
            work="''${DOMICILE_RUN_DIR:-''${XDG_CACHE_HOME:-$HOME/.cache}/domicile/${builtins.baseNameOf self}}"
            if [ ! -e "$work/.domicile-staged" ]; then
              echo "domicile: staging the source in $work" >&2
              mkdir -p "$work"
              # Modes are preserved (the scripts must stay executable), so the
              # copy inherits the store's read-only bits and needs +w.
              cp -RT "${self}" "$work"
              chmod -R u+w "$work"
              touch "$work/.domicile-staged"
            fi
            cd "$work"
            # The staged copy is the *git* source, so it has no node_modules —
            # and the harnesses the e2e scripts drive are bun programs that
            # import the workspace packages. Without this they die on their
            # first import, which from the script's side looks like a chrome
            # that simply never connected.
            #
            # The e2e and smoke scripts expect target/debug/domicile-compositor
            # to exist already; run-prototype.sh builds its own release binary,
            # so the debug build below is only for the checks.
            exec nix develop "${self}#full" --command bash -c \
              "bun install --frozen-lockfile && cargo build -p domicile-compositor && exec ./scripts/${script}"
          '';
        };

      # `nix run .#<attr>` → `scripts/<script>.sh`. `prototype` is also the
      # default app, so a bare `nix run github:cprussin/domicile` boots the
      # prototype.
      scriptApps = pkgs.lib.mapAttrs
        (name: script: {
          type = "app";
          program = pkgs.lib.getExe (runInFullShell name script);
          meta.description = "Run scripts/${script} with no checkout";
        })
        {
          check = "check.sh";
          prototype = "run-prototype.sh";
          native = "run-native.sh";
          measure = "measure.sh";
          measure-round-trip = "measure-round-trip.sh";
          e2e-chrome = "e2e-chrome.sh";
          e2e-electron = "e2e-electron.sh";
          e2e-no-compositor = "e2e-no-compositor.sh";
          e2e-spawn = "e2e-spawn.sh";
          e2e-input = "e2e-input.sh";
          e2e-dmabuf = "e2e-dmabuf.sh";
          e2e-chrome-layer = "e2e-chrome-layer.sh";
          e2e-hidpi = "e2e-hidpi.sh";
          probe-transparency = "probe-transparency.sh";
          e2e-slow-chrome = "e2e-slow-chrome.sh";
          smoke-compositor = "smoke-compositor.sh";
        };
    in
    {
      apps.${system} = scriptApps // { default = scriptApps.prototype; };

      devShells.${system} = {
        # Default shell: everything needed for the TDD pure-logic core.
        default = pkgs.mkShell {
          packages = coreTools;
          RUST_BACKTRACE = "1";
          FORCE_COLOR = 1;
          # biome resolves its platform binary from here instead of downloading
          # one, so the nix-pinned version is the one turbo runs.
          BIOME_BINARY = pkgs.lib.getExe pkgs.biome;
          shellHook = ''
            echo "domicile dev shell (core) — cargo $(cargo --version 2>/dev/null | cut -d' ' -f2), bun $(bun --version 2>/dev/null)"
          '';
        };

        # Full shell: adds Wayland/DRM/GPU libraries for domicile-host + domicile-bridge.
        full = pkgs.mkShell {
          packages = coreTools ++ hostLibs;
          RUST_BACKTRACE = "1";
          FORCE_COLOR = 1;
          BIOME_BINARY = pkgs.lib.getExe pkgs.biome;
          # Use the nix-provided electron rather than downloading one.
          ELECTRON_OVERRIDE_DIST_PATH = "${pkgs.electron}/bin";
          ELECTRON_SKIP_BINARY_DOWNLOAD = 1;
          # The compositor `dlopen`s libEGL to import client dmabufs, and
          # `mkShell` only wires build-time linkage — a package in `packages`
          # is not on the runtime loader path. `/run/opengl-driver/lib` comes
          # first because on NixOS that is the EGL vendor matching the running
          # kernel driver; the nixpkgs copies behind it cover a non-NixOS host.
          LD_LIBRARY_PATH =
            "/run/opengl-driver/lib:${pkgs.lib.makeLibraryPath [
              pkgs.libGL
              pkgs.mesa
              pkgs.libgbm
              # winit dlopens the Wayland and X11 client libraries to decide
              # which display server it is talking to, so both have to be here
              # even though only one gets used. Without them it reports
              # `NoWaylandLib` and opens no window — the same shape of failure
              # libEGL had, for the same reason.
              pkgs.wayland
              pkgs.libxkbcommon
              pkgs.libx11
              pkgs.libxcursor
              pkgs.libxrandr
              pkgs.libxi
            ]}";
          shellHook = ''
            echo "domicile dev shell (full: +wayland +drm +gl)"
          '';
        };
      };
    };
}
