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
        # Electron runs the chrome, both as Domicile's own Wayland client and
        # over the chrome protocol socket (the eventual target embeds CEF;
        # Electron gets us a testable UI now).
        electron
        # Xvfb lets us exercise the Electron chrome headlessly in tests
        # (provides the `Xvfb` binary used by scripts/e2e-electron.sh).
        xvfb
        # There is no window manager on an Xvfb, so `xdotool` is what resizes
        # Domicile's own window in `e2e-chrome-fills-a-window.sh` — the one
        # check that drives `--present`. Without it here that check skips, and
        # `nix run .#e2e-chrome-fills-a-window` could never do anything else.
        xdotool
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
            # to exist already, which is what the debug build below is for.
            # run-native.sh and measure.sh build their own release binaries —
            # both are interactive or timed, and debug is a 4fps ceiling on any
            # client that takes the copy path.
            # The script's own arguments reach it in two hops, which is what
            # lets `nix run .#native -- simple` pick a shell. `\$@` is escaped
            # so the *inner* bash expands it from its own positional parameters
            # rather than this one baking the words in; those parameters are the
            # trailing `"$@"`, since `bash -c CMD name args...` is how a `-c`
            # command is given any.
            exec nix develop "${self}#full" --command bash -c \
              "bun install --frozen-lockfile && cargo build -p domicile-compositor && exec ./scripts/${script} \"\$@\"" \
              domicile-${name} "$@"
          '';
        };

      # `nix run .#<attr>` → `scripts/<script>.sh`. `native` is also the default
      # app, so a bare `nix run github:cprussin/domicile` starts the compositor
      # — which is the only thing here that is one. The copy path is reached
      # through it, not instead of it.
      scriptApps = pkgs.lib.mapAttrs
        (name: script: {
          type = "app";
          program = pkgs.lib.getExe (runInFullShell name script);
          meta.description = "Run scripts/${script} with no checkout";
        })
        {
          check = "check.sh";
          native = "run-native.sh";
          measure = "measure.sh";
          measure-round-trip = "measure-round-trip.sh";
          e2e-chrome = "e2e-chrome.sh";
          e2e-electron = "e2e-electron.sh";
          e2e-shell-launch = "e2e-shell-launch.sh";
          e2e-late-chrome = "e2e-late-chrome.sh";
          e2e-chrome-without-a-host = "e2e-chrome-without-a-host.sh";
          e2e-spawn = "e2e-spawn.sh";
          e2e-input = "e2e-input.sh";
          e2e-dmabuf = "e2e-dmabuf.sh";
          e2e-chrome-layer = "e2e-chrome-layer.sh";
          e2e-hidpi = "e2e-hidpi.sh";
          probe-transparency = "probe-transparency.sh";
          e2e-slow-chrome = "e2e-slow-chrome.sh";
          e2e-close = "e2e-close.sh";
          e2e-compose = "e2e-compose.sh";
          e2e-stuck-key = "e2e-stuck-key.sh";
          e2e-two-displays = "e2e-two-displays.sh";
          e2e-displays-on-hello = "e2e-displays-on-hello.sh";
          e2e-desktop-changed = "e2e-desktop-changed.sh";
          e2e-reload-displays = "e2e-reload-displays.sh";
          e2e-one-window-per-display = "e2e-one-window-per-display.sh";
          e2e-chrome-fills-the-desktop = "e2e-chrome-fills-the-desktop.sh";
          e2e-chrome-fills-a-window = "e2e-chrome-fills-a-window.sh";
          e2e-window-follows-the-desktop = "e2e-window-follows-the-desktop.sh";
          e2e-two-chromes = "e2e-two-chromes.sh";
          e2e-window-alpha = "e2e-window-alpha.sh";
          smoke-compositor = "smoke-compositor.sh";
          test-out-of-tree-shell = "test-out-of-tree-shell.sh";
          test-every-launch-names-a-shell = "test-every-launch-names-a-shell.sh";
        };
    in
    {
      apps.${system} = scriptApps // { default = scriptApps.native; };

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
