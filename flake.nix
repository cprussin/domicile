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
        # Electron gets us a testable UI now). The binding above rather than
        # `pkgs.electron`, so the checks run the major the packages ship.
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

      # ── What a user installs ────────────────────────────────────────────
      #
      # A shell, and nothing else. That is the whole arrangement Domicile is
      # built around: a shell is the program on `PATH`, it owns the
      # configuration, and it starts the compositor underneath itself. So the
      # build outputs here are shells — `nix build .#manganese`, `.#simple` —
      # and there is deliberately no `default` and nothing called `domicile`.
      # A user picks a desktop; they do not install a compositor and then look
      # for something to point at it.

      # The Electron everything here runs on: the packages below and the dev
      # shell both, so what is tested and what ships are the same major.
      #
      # Named rather than taken from the `electron` alias, which floats with
      # every `flake.lock` bump — at the pinned revision it is 41, two majors
      # below what the workspace builds and type-checks against, and it was
      # what the dev shell had been running all along.
      #
      # `wantedElectron` reads the major out of the workspace's own catalog,
      # and the `pkgs."electron_${…}"` lookup below is what makes a catalog
      # bump a failure rather than a person remembering: nixpkgs has no
      # attribute for a major it does not carry, so the flake stops
      # evaluating. The `assert` after it only fires if `electron_N` were to
      # carry some other major, which nixpkgs does not do — a belt on a belt,
      # kept because it costs nothing and states the invariant.
      #
      # Only the major: nixpkgs carries 43.2.0 against a catalog `^43.3.0`, so
      # the minor is already behind and nixpkgs is what there is. A pin that
      # cannot be met exactly is worth saying out loud rather than asserting
      # around.
      #
      # This binds the dev shell too, so a catalog bump to a major nixpkgs
      # lacks stops `nix develop` as well as `nix build`. Deliberate: a dev
      # shell quietly testing a different major from the one the packages ship
      # is the failure this exists to end, and it is what was happening.
      wantedElectron =
        let
          catalog = (builtins.fromJSON (builtins.readFile ./package.json)).catalog;
          found = builtins.match "[^0-9]*([0-9]+).*" catalog.electron;
        in
        if found == null then
        # A range with no digits in it — `*`, `latest`. Nothing spells a
        # catalog that way, but `builtins.head null` names neither the file
        # nor the value, and this is a failure someone would meet while
        # editing something else.
          throw ("no major version in package.json's catalog.electron: "
            + catalog.electron)
        else
          builtins.head found;
      electron =
        let named = pkgs."electron_${wantedElectron}";
        in assert pkgs.lib.versions.major named.version == wantedElectron; named;

      # The workspace's Rust crates, by the file that makes one.
      rustCrates = builtins.attrNames (pkgs.lib.filterAttrs
        (name: _: builtins.pathExists (./packages + "/${name}/Cargo.toml"))
        (builtins.readDir ./packages));

      # The compositor, which no output exposes on its own.
      #
      # Not hidden, just not a thing to install: it takes a chrome socket and a
      # session file on its command line and refuses to start without them, so
      # a user who ran it would get a usage error. The shells below put it on
      # their own `PATH` and that is the only way it is meant to be reached.
      domicile-compositor = pkgs.rustPlatform.buildRustPackage {
        pname = "domicile-compositor";
        version = "0.0.0";
        # Whole crate directories rather than the `.rs` files in them, and
        # `scripts/` and `ROADMAP.md` besides.
        #
        # Twice now this filter has been *almost* right, which is the failure
        # mode worth naming: it drops something an `include_str!` reaches for,
        # and a build with no checkout to compare against says only that a file
        # is missing. First the two GLSL shaders under `src/shaders`, dropped
        # by a filter on the `.rs` extension. Then two e2e scripts and
        # `ROADMAP.md`, which the *test* targets read to check that what those
        # files say still matches the code — invisible here, because
        # `cargoBuildFlags` never builds a test target, so the filter and
        # `doCheck = false` were quietly holding each other up.
        #
        # So the rule is the whole of what `cargo` can reach, not the whole of
        # what this particular build happens to compile.
        src = pkgs.lib.fileset.toSource {
          root = ./.;
          fileset = pkgs.lib.fileset.unions
            ([ ./Cargo.toml ./Cargo.lock ./ROADMAP.md ./scripts ]
              ++ map (name: ./packages + "/${name}") rustCrates);
        };
        cargoLock.lockFile = ./Cargo.lock;

        nativeBuildInputs = [ pkgs.pkg-config pkgs.makeWrapper ];
        # libxkbcommon is the only one linked; the rest are here because
        # Smithay's winit and EGL paths probe for them at build time. What they
        # are `dlopen`ed from at *run* time is the wrapper below.
        buildInputs = with pkgs; [ libxkbcommon wayland libGL libgbm ];

        # `default-members` leaves this crate out — it is the one thing in the
        # workspace that needs a graphics stack — so it has to be named.
        cargoBuildFlags = [ "-p" "domicile-compositor" ];

        # Not because they would fail — the ones needing a GPU are `#[ignore]`d
        # and CI runs the rest with no GL stack at all — but because a package
        # build is not where this workspace's tests are paid for. `cargo-test`
        # runs them on every push, against the same lockfile, and running them
        # again per install buys nothing but minutes.
        doCheck = false;

        # The compositor `dlopen`s libEGL to import client dmabufs, and winit
        # `dlopen`s the Wayland and X11 client libraries to work out which
        # display server it is talking to. None of that is linkage, so none of
        # it is on the loader path without saying so. `/run/opengl-driver/lib`
        # first because on NixOS that is the EGL vendor matching the running
        # kernel driver; the nixpkgs copies behind it cover other hosts.
        postFixup = ''
          patchelf --add-rpath "${pkgs.lib.makeLibraryPath (with pkgs; [
            libGL mesa libgbm wayland libxkbcommon
            libx11 libxcursor libxrandr libxi
          ])}" "$out/bin/domicile-compositor"
          wrapProgram "$out/bin/domicile-compositor" \
            --prefix LD_LIBRARY_PATH : "/run/opengl-driver/lib"
        '';
      };

      # Everything `bun install` would fetch, as one derivation.
      #
      # Fixed-output because it is the one step that needs the network, and its
      # input is the lockfile rather than the source: only the manifests are in
      # `src`, so editing a `.ts` file does not re-resolve the world. Scripts
      # are not run — the one that matters is Electron's, which downloads a
      # binary this build has no use for and no network to fetch.
      #
      # `outputHash` changes with `bun.lock`, and keeping the two in step is a
      # person's job — the pinned nixpkgs has no `buildBunPackage`, so nothing
      # derives one from the other.
      #
      # A mismatch is a loud failure naming both hashes, but *only on a store
      # that has not built this before*: a fixed-output derivation's path is a
      # function of the hash and the name rather than of its inputs, so once
      # the path is valid nix skips the builder entirely. On a machine that has
      # built it once, a stale hash is silence — the shell quietly built
      # against the old dependency tree, which is worse than the mismatch.
      # The reliably cold store is a fresh CI runner, which is the strongest
      # argument for `.github/workflows/nix-build.yml` existing.
      nodeModules = pkgs.stdenv.mkDerivation {
        pname = "domicile-node-modules";
        version = "0.0.0";
        src = pkgs.lib.fileset.toSource {
          root = ./.;
          fileset = pkgs.lib.fileset.unions ([ ./package.json ./bun.lock ./bunfig.toml ]
            ++ pkgs.lib.mapAttrsToList (name: _: ./packages + "/${name}/package.json")
              (pkgs.lib.filterAttrs
                (name: _: builtins.pathExists (./packages + "/${name}/package.json"))
                (builtins.readDir ./packages)));
        };
        nativeBuildInputs = [ pkgs.bun ];
        dontConfigure = true;
        buildPhase = ''
          runHook preBuild
          export HOME="$TMPDIR"
          bun install --frozen-lockfile --ignore-scripts --no-progress
          runHook postBuild
        '';
        # Every `node_modules` bun made, at the depth it made it. Not just the
        # root one: bun hoists what it can and leaves the rest per package —
        # `panda` and `tsc` are both in `packages/*/node_modules/.bin`, and a
        # build with only the root tree gets `command not found` from a script
        # that works in a checkout. The layout is preserved exactly because
        # what is in these directories is relative symlinks, and they only
        # resolve if the depth they were made at is the depth they are used at.
        installPhase = ''
          runHook preInstall
          rm -rf node_modules/.cache
          # What makes this hash a constant rather than a coin flip.
          #
          # `bun install` is not deterministic here: about one run in six links
          # a transitive package's own `.bin` entry that the other five do not
          # (`update-browserslist-db`'s, as it happens), and a fixed-output
          # derivation whose output varies is a hash that is simply *wrong* for
          # some fraction of everyone — on a clean checkout, with the lockfile
          # untouched, with nothing to suggest what went wrong.
          #
          # These directories are bun's own internal store; nothing reaches
          # into them. What is run here comes from the root and per-package
          # `.bin`, both kept above. So they are dropped rather than trusted to
          # come out the same twice.
          find node_modules/.bun -mindepth 3 -maxdepth 3 \
            -type d -path '*/node_modules/.bin' -exec rm -rf {} +
          mkdir -p "$out"
          cp -a node_modules "$out/node_modules"
          for tree in packages/*/node_modules; do
            mkdir -p "$out/$(dirname "$tree")"
            cp -a "$tree" "$out/$tree"
          done
          runHook postInstall
        '';
        dontFixup = true;
        outputHashMode = "recursive";
        outputHashAlgo = "sha256";
        outputHash = "sha256-Mi6j/u97lxV7jYcqe/dq5xWYNqdwytEOAbVroupazjA=";
      };

      # What settles how Node parses the bundles, beside the bundles.
      #
      # `docs/WRITING-A-SHELL.md` asks a shell to ship a `package.json` so its
      # ESM launcher and main bundle are read as ESM by something stated rather
      # than by Node's module detection. The rule is about the *nearest*
      # `package.json` walking up from those files, so this belongs next to
      # them rather than at the root of the output.
      #
      # At the root it also broke something: a top-level regular file is the
      # one shape `nix profile` cannot merge, so two shells could not share a
      # profile — `nix profile add .#simple .#manganese` failed on the
      # conflict, where before they coexisted. `.vite/` never reaches a profile
      # at all, the builder skipping dotfiles, so putting it here costs
      # nothing and keeps both installable.
      #
      # `type` only. The guide's other field is `bin`, which is how a *package
      # manager* finds the stub — and nix links `$out/bin` itself, so it earns
      # nothing on the install path this flake documents. Written rather than
      # copied from the workspace, whose manifest carries `workspace:*`
      # dependencies that are not in the output.
      manifest = pkgs.writeText "package.json" (builtins.toJSON { type = "module"; });

      # A shell, built and installed the way a user runs one.
      #
      # `name` is both the workspace package's suffix and the command: the
      # `bin/` stub in the source is what ends up on `PATH`, unchanged except
      # for being told where the compositor and Electron are. It finds its own
      # bundle relative to itself, so the whole `.vite` tree comes along.
      shell = { name, description }:
        pkgs.stdenv.mkDerivation {
          pname = "domicile-shell-${name}";
          version = "0.0.0";
          src = self;

          # Node as well as bun: the workspace's binaries are installed as
          # `#!/usr/bin/env node` shims, so turbo and vite are run by node
          # even though bun is what installed them. Pinned to the major
          # `package.json` asks for, same as the dev shell.
          nativeBuildInputs = [ pkgs.bun pkgs.nodejs_24 pkgs.makeWrapper ];

          configurePhase = ''
            runHook preConfigure
            cp -a "${nodeModules}/node_modules" node_modules
            for tree in "${nodeModules}"/packages/*/node_modules; do
              cp -a "$tree" "packages/$(basename "$(dirname "$tree")")/node_modules"
            done
            chmod -R u+w node_modules packages/*/node_modules
            # The workspace's binaries are `#!/usr/bin/env node` shims, and a
            # sandboxed build has no `/usr/bin/env` — `turbo` fails to exec
            # with `bad interpreter` before it has run anything. Only visible
            # in a sandbox: without one the build quietly borrows the host's,
            # so this passed on the machine it was written on and failed on the
            # first CI run. `patchShebangs` rewrites them to the store's node.
            patchShebangs node_modules packages/*/node_modules
            export HOME="$TMPDIR"
            # `//#build:install-modules` runs `bun install` unless this is set,
            # and there is no network here — the modules above are the install.
            export CI=1
            # turbo writes both of these, and $HOME is the only writable place.
            export TURBO_CACHE_DIR="$TMPDIR/turbo"
            export TURBO_TELEMETRY_DISABLED=1
            runHook postConfigure
          '';

          buildPhase = ''
            runHook preBuild
            node_modules/.bin/turbo build:vite \
              --filter "@domicile/shell-${name}" --no-daemon
            runHook postBuild
          '';

          # The stub's own layout: it resolves `.vite` as `$(dirname $0)/..`,
          # so `bin/` and `.vite/` have to sit beside each other exactly as
          # they do in the workspace.
          installPhase = ''
            runHook preInstall
            mkdir -p "$out/bin"
            cp -R "packages/shell-${name}/.vite" "$out/.vite"
            install -Dm755 "packages/shell-${name}/bin/${name}" "$out/bin/${name}"
            # `type`, which is what `docs/WRITING-A-SHELL.md` asks a shell to
            # ship this for: the launcher and main bundles are ESM and use
            # `import.meta.url`, and what settles how Node parses a `.js` file
            # is the nearest `package.json` walking up from it. Without one
            # they work by Node's detection heuristic rather than by anything
            # stated — which is the thing that guide names to avoid, and this
            # flake is its reference implementation.
            #
            # Written rather than copied from the workspace: that one carries
            # `workspace:*` dependencies that are not here and a `devDependencies`
            # block that means nothing to an installed desktop.
            install -Dm644 "${manifest}" "$out/.vite/build/package.json"
            runHook postInstall
          '';

          # The two programs a shell starts, named rather than looked for.
          # `--set-default` and not `--set`: both are documented ways to point
          # a shell at something else — a compositor built from a checkout, an
          # Electron with different flags — and a wrapper that overrode the
          # environment would take that away.
          postFixup = ''
            wrapProgram "$out/bin/${name}" \
              --set-default DOMICILE_COMPOSITOR "${domicile-compositor}/bin/domicile-compositor" \
              --set-default DOMICILE_ELECTRON "${electron}/bin/electron"
          '';

          meta = {
            inherit description;
            mainProgram = name;
            platforms = [ system ];
          };
        };

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
          e2e-input = "e2e-input.sh";
          e2e-dmabuf = "e2e-dmabuf.sh";
          e2e-chrome-layer = "e2e-chrome-layer.sh";
          e2e-hidpi = "e2e-hidpi.sh";
          probe-transparency = "probe-transparency.sh";
          e2e-compose = "e2e-compose.sh";
          e2e-stuck-key = "e2e-stuck-key.sh";
          e2e-modifiers = "e2e-modifiers.sh";
          e2e-bands = "e2e-bands.sh";
          e2e-window-shows-through = "e2e-window-shows-through.sh";
          e2e-reload-displays = "e2e-reload-displays.sh";
          e2e-one-window-per-display = "e2e-one-window-per-display.sh";
          e2e-chrome-fills-the-desktop = "e2e-chrome-fills-the-desktop.sh";
          e2e-chrome-fills-a-window = "e2e-chrome-fills-a-window.sh";
          e2e-window-follows-the-desktop = "e2e-window-follows-the-desktop.sh";
          e2e-window-alpha = "e2e-window-alpha.sh";
          smoke-compositor = "smoke-compositor.sh";
          test-out-of-tree-shell = "test-out-of-tree-shell.sh";
        };
    in
    {
      # Two, and no `default`. `nix build` on its own has nothing to build
      # here on purpose: which desktop you want is the only question this
      # flake cannot answer for you.
      packages.${system} = {
        manganese = shell {
          name = "manganese";
          description = "The Domicile desktop: tabbed windows, a launcher, and a settings surface";
        };
        simple = shell {
          name = "simple";
          description = "The smallest Domicile desktop: floating windows on the Alt key, Alt+Enter for a terminal";
        };
      };

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
          # Use the nix-provided electron rather than downloading one — the
          # same one `hostLibs` puts on `PATH`, so the `electron` npm package
          # and the binary the scripts find cannot be different majors.
          ELECTRON_OVERRIDE_DIST_PATH = "${electron}/bin";
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
