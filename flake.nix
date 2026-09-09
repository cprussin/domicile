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
        # `scripts/update-engine-release.sh` reads a GitHub release with curl
        # and jq; `.github/scripts/engine-release-*.sh` do the same and pack a
        # zstd tarball; `spike-iframe.sh` fetches a page. In the core shell
        # rather than the full one because the release workflow runs in it.
        #
        # Fetching the engine itself is NOT among these any more: that is a
        # `fetchurl` in a derivation now, and nix does the download, the hash
        # and the cache.
        curl
        jq
        zstd
        # WITH THE CA BUNDLE, because this curl shadows the system's inside
        # every shell and every `nix run` app. It reads CAs from OpenSSL's
        # default path, which on a Fedora- or SUSE-shaped host holds nothing —
        # and the release scripts would report a certificate failure as "no
        # release tagged engine-nightly", the least true message available.
        #
        # This package alone is what fixes it: its setup hook exports
        # `NIX_SSL_CERT_FILE`, which nixpkgs' OpenSSL honours. Setting
        # `SSL_CERT_FILE` on the shells instead does nothing at all — it is in
        # nix's own ignore list and never reaches the shell, which is worth
        # writing down because it looks like it would.
        cacert
      ];

      # Native libraries the compositor needs: Smithay's Wayland stack, and the
      # GL and DRM the dmabuf import goes through. Split out so the core shell
      # stays lean; enter with `nix develop .#full` to build against them.
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
        # Xvfb is what gives the compositor's own window a display to open on
        # where there is none — `--present`, under `e2e-a-dense-display.sh` and
        # `e2e-chrome-fills-a-window.sh`.
        xvfb
        # There is no window manager on an Xvfb, so `xdotool` is what resizes
        # Domicile's own window in `e2e-chrome-fills-a-window.sh` — the one
        # check that drives `--present`. Without it here that check skips, and
        # `nix run .#e2e-chrome-fills-a-window` could never do anything else.
        xdotool
      ];

      # What `libdomicile_engine.so` was linked against.
      #
      # The engine is a Chromium component, so it needs Chromium's runtime
      # libraries — and the compositor `dlopen`s it, which means they have to
      # be on the loader path of the shell the *compositor* runs in, not the
      # one the engine was built in. Before this the two sets lived in
      # different shells and neither was a superset: from the full shell the
      # engine would not load (`libglib-2.0.so.0: cannot open shared object
      # file`), and from Chromium's toolchain shell there was no EGL, so no
      # client could hand the compositor a dmabuf in the first place.
      #
      # Its own list rather than folded into `hostLibs` because nothing here is
      # Domicile's: it is what a prebuilt Chromium needs, and it changes when
      # Chromium's does. `packages/domicile-engine/CHROMIUM_PIN` says which
      # Chromium that is.
      engineRuntimeLibs = with pkgs; [
        glib
        nss
        nspr
        dbus
        # `atk` and `at-spi2-atk` are aliases of this in current nixpkgs, so
        # naming all three would put the same store path on the path thrice.
        at-spi2-core
        cups
        expat
        alsa-lib
        pango
        cairo
        gdk-pixbuf
        gtk3
        libdrm
        # libgbm.so.1, which Chromium needs to allocate buffers on a GPU. It
        # was on the dev shell's library path separately and missing here, so
        # the list called "what a prebuilt Chromium needs" did not have it —
        # which `autoPatchelfHook` said the first time anything asked.
        libgbm
        libxshmfence
        # libudev.so.1, which Chromium opens to enumerate input and GPU
        # devices. `udev` is an alias of this in nixpkgs; naming the package it
        # actually comes from keeps the list one entry per store path.
        systemd
        # Chromium links a wider set of X client libraries than winit does, and
        # needs them whether or not it runs on X: the ozone platform is chosen
        # at runtime, so they have to resolve either way.
        libxcomposite
        libxdamage
        libxext
        libxfixes
        libxrender
        libxtst
        libxcb
      ];

      # ── The engine CI built, as a package ───────────────────────────────
      #
      # The alternative was a script that curled the release, checked a
      # checksum, cached the result by name and patched the ELF — every one of
      # which nix already does, and does better: `fetchurl` is the checksum and
      # the cache, the store path is the name, and `autoPatchelfHook` is the
      # patching. It is also the only version that works on NixOS, where a
      # generic-linux Chromium cannot start at all: `/lib64/ld-linux-x86-64.so.2`
      # is a stub whose whole job is to say so.
      #
      # `dontStrip` because this is somebody else's release build and stripping
      # a 517 MB binary buys nothing here. `autoPatchelfIgnoreMissingDeps` is
      # not set: a library Chromium needs and this list lacks should fail the
      # build rather than the desktop.
      engineRelease = import ./packages/domicile-engine/engine-release.nix;
      domicileEngine = pkgs.stdenv.mkDerivation {
        pname = "domicile-engine";
        version = builtins.substring 0 7 engineRelease.commit;

        src = pkgs.fetchurl { inherit (engineRelease) url hash; };

        nativeBuildInputs = [ pkgs.autoPatchelfHook pkgs.zstd pkgs.makeWrapper ];
        buildInputs = engineRuntimeLibs;
        dontStrip = true;

        # The tarball holds one directory; `run-engine.sh` joins `$CHROMIUM` and
        # `$OUT`, so `OUT=.` and this is that directory.
        unpackPhase = ''
          runHook preUnpack
          mkdir -p unpacked
          tar --use-compress-program=unzstd -xf "$src" -C unpacked
          cd unpacked/*
          runHook postUnpack
        '';

        installPhase = ''
          runHook preInstall
          mkdir -p "$out"
          cp -R . "$out/"
          runHook postInstall
        '';

        # WHAT `autoPatchelfHook` CANNOT SEE. It rewrites the interpreter and
        # the rpath from what a binary *links*, and Chromium does not link its
        # GL stack — it `dlopen`s `libEGL.so.1` at run time and decides what it
        # got. So the patched engine started, ran, and lost its GPU process on
        # every machine:
        #
        #   Could not dlopen native EGL: libEGL.so.1: cannot open shared
        #   object file: No such file or directory
        #   … Exiting GPU process due to errors during initialization
        #
        # which is a white window and a desktop that never draws. Reported from
        # a real machine with a working AMD GPU, whose compositor half had
        # already found the same card and imported dmabufs from it.
        #
        # A wrapper rather than an rpath, and this is the one place that
        # distinction has bitten before: chrome re-execs itself for its zygote
        # and its renderers, so anything that has to survive into the children
        # must be inherited. An environment variable is; a loader invoked by
        # hand is not.
        #
        # `/run/opengl-driver/lib` first, because on NixOS that is the vendor
        # library matching the running kernel driver, and the nixpkgs copies
        # behind it are what a non-NixOS host has instead. The dev shell's own
        # `LD_LIBRARY_PATH` is built the same way and says the same thing.
        postFixup = ''
          mv "$out/chrome" "$out/.chrome-unwrapped"
          makeWrapper "$out/.chrome-unwrapped" "$out/chrome" \
            --prefix LD_LIBRARY_PATH : "/run/opengl-driver/lib:${
              pkgs.lib.makeLibraryPath [
                pkgs.libglvnd
                pkgs.mesa
                pkgs.libgbm
                pkgs.libGL
              ]
            }"
        '';

        # The two things every consumer of this looks up by name, so a release
        # missing one fails here rather than four minutes into a desktop.
        doInstallCheck = true;
        installCheckPhase = ''
          for needed in chrome libdomicile_engine.so; do
            [ -e "$out/$needed" ] || {
              echo "the published engine has no $needed" >&2
              exit 1
            }
          done
          # Through the wrapper, which is the only way anything starts this.
          "$out/chrome" --version
          # And that the wrapper is one: a `mv` that silently did nothing
          # leaves the real binary here under its own name, `--version` still
          # works, and the GPU process still dies on the machine that runs it.
          grep -q LD_LIBRARY_PATH "$out/chrome" || {
            echo "the engine's chrome is not wrapped, so it carries no GL path" >&2
            exit 1
          }
        '';

        meta.description =
          "The patched Chromium domicile-compositor uses as its engine";
      };

      # ── The three things a desktop is made of ───────────────────────────
      #
      # `run-engine.sh` starts a bridge, an engine and a compositor, and takes
      # each as a path. A checkout builds them; these are the same three built
      # once, in the store, so `nix run` starts a desktop instead of a build.

      # The page. Only the renderer bundle: `build:vite` also produces the
      # launcher, main and preload bundles, and none of those is a web page —
      # they are how a shell is started somewhere that is not a browser.
      shellPage = name: pkgs.stdenv.mkDerivation {
        pname = "domicile-page-${name}";
        version = "0.0.0";
        src = self;
        nativeBuildInputs = [ pkgs.bun pkgs.nodejs_24 ];
        configurePhase = sharedShellConfigure;
        buildPhase = ''
          runHook preBuild
          node_modules/.bin/turbo build:vite \
            --filter "@domicile/shell-${name}" --no-daemon
          runHook postBuild
        '';
        # `main_window` is what the shell's own `vite.renderer.config.ts` calls
        # the one window it opens, and it stays that here: this installs the
        # shell's build rather than rearranging it.
        installPhase = ''
          runHook preInstall
          cp -R "packages/shell-${name}/.vite/renderer/main_window" "$out"
          runHook postInstall
        '';
        # A page with nothing to load is not a page, and the way that fails at
        # runtime is a browser on a blank screen — which reads as the seam.
        #
        # `shell.js` now rather than `index.html`: a shell in this workspace is
        # a *module*, Domicile writes the document, and the name is fixed by
        # `@domicile/component-library/vite-shell` precisely so that something
        # other than the shell can name it. A build that emitted a hashed entry
        # would satisfy no check anybody could write.
        doInstallCheck = true;
        installCheckPhase = ''
          [ -f "$out/shell.js" ] || {
            echo "${name} built no shell.js; it has:" >&2
            ls "$out" >&2
            exit 1
          }
        '';
      };

      # The bridge, which is a bun program and stays one: it serves the page
      # and proxies the compositor's socket, and bundling it would be a second
      # way to build something that has exactly one entry point.
      domicileBridge = pkgs.stdenv.mkDerivation {
        pname = "domicile-bridge-host";
        version = "0.0.0";
        src = self;
        nativeBuildInputs = [ pkgs.bun pkgs.nodejs_24 ];
        configurePhase = sharedShellConfigure;
        dontBuild = true;
        installPhase = ''
          runHook preInstall
          mkdir -p "$out"
          cp -R packages "$out/packages"
          cp -R node_modules "$out/node_modules"
          cp package.json "$out/package.json"
          runHook postInstall
        '';
        passthru.entry = "packages/engine-chrome-host/src/main.ts";
      };

      # A desktop: the page, the engine, the compositor and the bridge, handed
      # to the one script that knows how to start them in the order they have
      # to start in. Every one is `:-` against what is already set, because
      # each is something a developer legitimately overrides — a compositor
      # built from a checkout, a page they are iterating on — and a wrapper
      # that set them outright would take that away.
      desktop = { name, description }:
        pkgs.writeShellApplication {
          # The desktop's own name, so `nix profile install .#manganese` puts
          # `manganese` on the PATH rather than something with a prefix nobody
          # typed. It is also what `mainProgram` says, and what CI checks for.
          inherit name;
          runtimeInputs = [ pkgs.bun ];
          text = ''
            export DOMICILE_PAGE="''${DOMICILE_PAGE:-${shellPage name}}"
            export DOMICILE_ENGINE="''${DOMICILE_ENGINE:-${domicileEngine}}"
            export DOMICILE_COMPOSITOR="''${DOMICILE_COMPOSITOR:-${domicile-compositor}/bin/domicile-compositor}"
            export DOMICILE_BRIDGE="''${DOMICILE_BRIDGE:-${domicileBridge}/${domicileBridge.passthru.entry}}"
            # `OUT=.` because a published engine *is* the out directory, where
            # a Chromium checkout has one under `out/Domicile`. `:-` like the
            # rest: `DOMICILE_ENGINE=/build/chromium/src` is exactly the
            # override the four above invite, and it needs `OUT=out/Domicile`
            # to go with it.
            export OUT="''${OUT:-.}"
            exec ${self}/scripts/run-engine.sh "$DOMICILE_ENGINE" ${name} "$@"
          '';
          meta = {
            inherit description;
            mainProgram = name;
            platforms = [ system ];
          };
        };

      # ── What a user installs ────────────────────────────────────────────
      #
      # A desktop, or Domicile itself. A desktop — `nix build .#manganese`,
      # `.#simple` — is Domicile with a page already chosen, and is what
      # somebody who wants one of the two this repository ships installs.
      # `.#domicile` is the same runner with the choice left open, for somebody
      # whose desktop is their own; it takes the path to a built shell.
      #
      # What there is still no `default` *package* for is the same reason as
      # ever: which desktop you want is the one question this flake cannot
      # answer for you. `nix run` does have a default, and it is Domicile
      # asking that question rather than answering it.

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
        #
        # And the binary too, not just the package: the crate owns a second
        # `[[bin]]`, `domicile-test-client`, which exists so that cargo builds
        # a Wayland client whenever it builds the tests that spawn one. It is
        # test scaffolding, and naming the binary here is what keeps it out of
        # what this package installs.
        cargoBuildFlags = [ "-p" "domicile-compositor" "--bin" "domicile-compositor" ];

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
      # are not run: nothing in the tree needs one, and a postinstall that
      # reaches for the network is a build that cannot be reproduced.
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
        outputHash = "sha256-LTPpmKKb3mGrLtkQBpaIRlmGnSeJj1l8WI5xVAq36Nw=";
      };


      # A shell, built and installed the way a user runs one.
      #
      # `name` is both the workspace package's suffix and the command, so
      # `nix profile install .#simple` puts `simple` on `PATH`. What that
      # command is, is `run-engine.sh` with every input it needs already
      # named: the built page, the engine, the compositor and the bridge.
      # Everything a workspace build needs before it can run turbo: the
      # installed modules copied in writable, shebangs patched to the store's
      # node, and turbo's own writable directories. Shared by the three
      # derivations that build out of this workspace, because a second copy of
      # it is a second thing to keep true.
      sharedShellConfigure = ''
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
            # The script's own arguments reach it in two hops, which is what
            # lets `nix run .#dev-check -- --only e2e` pass one on. `\$@` is escaped
            # so the *inner* bash expands it from its own positional parameters
            # rather than this one baking the words in; those parameters are the
            # trailing `"$@"`, since `bash -c CMD name args...` is how a `-c`
            # command is given any.
            # The features are named again because a CLI flag does not reach a
            # nested invocation. `nix run --extra-experimental-features
            # 'nix-command flakes' github:cprussin/domicile#engine` is how a
            # machine that has not edited nix.conf runs any of this, and until
            # now it got all the way through staging the source and then died
            # here saying nix-command was disabled — which reads as the flake
            # being broken rather than as a flag that needed repeating. On a
            # machine that has them enabled this changes nothing.
            exec nix --extra-experimental-features "nix-command flakes" \
              develop "${self}#full" --command bash -c \
              "bun install --frozen-lockfile && cargo build -p domicile-compositor && exec ./scripts/${script} \"\$@\"" \
              domicile-${name} "$@"
          '';
        };

      # Domicile itself: the thing you point at a shell.
      #
      # `nix run github:cprussin/domicile -- ./my-desktop/dist` is the whole
      # interface a shell author has. The two desktops below are this with a
      # page already chosen; this is the same runner with the choice left to
      # whoever runs it, which is what makes an out-of-tree shell a first-class
      # thing rather than something the flake has to have heard of.
      #
      # It sets three of the four inputs and deliberately not `DOMICILE_PAGE`:
      # that one is the argument. A desktop that named it *and* passed a shell
      # name would be handing `run-engine.sh` two answers to one question.
      domicileCli = pkgs.writeShellApplication {
        name = "domicile";
        runtimeInputs = [ pkgs.bun ];
        text = ''
          # REFUSED RATHER THAN DEFAULTED. `run-engine.sh`'s own default is
          # `simple`, which means "build packages/shell-simple out of the
          # checkout" — and there is no checkout here, only the flake source in
          # the store. A bare `nix run github:cprussin/domicile` would go
          # looking for a workspace it cannot build and fail somewhere further
          # in, about a directory the person never mentioned. The desktops are
          # their own apps; this one needs to be told.
          if [ "$#" -eq 0 ]; then
            echo "domicile: which shell? Give me the directory your shell built," >&2
            echo "  or the entry point inside it:" >&2
            echo "" >&2
            echo "    nix run github:cprussin/domicile -- ./my-desktop/dist" >&2
            echo "" >&2
            echo "  The two desktops this repository ships are apps of their own:" >&2
            echo "    nix run github:cprussin/domicile#manganese" >&2
            echo "    nix run github:cprussin/domicile#simple" >&2
            exit 2
          fi
          export DOMICILE_ENGINE="''${DOMICILE_ENGINE:-${domicileEngine}}"
          export DOMICILE_COMPOSITOR="''${DOMICILE_COMPOSITOR:-${domicile-compositor}/bin/domicile-compositor}"
          export DOMICILE_BRIDGE="''${DOMICILE_BRIDGE:-${domicileBridge}/${domicileBridge.passthru.entry}}"
          # `OUT=.` because a published engine *is* the out directory, where a
          # Chromium checkout has one under `out/Domicile`.
          export OUT="''${OUT:-.}"
          exec ${self}/scripts/run-engine.sh "$DOMICILE_ENGINE" "$@"
        '';
        meta = {
          description = "Run a Domicile desktop from a shell you built yourself";
          mainProgram = "domicile";
          platforms = [ system ];
        };
      };

      # The two desktops this repository ships. Bound once so that
      # `packages` and `apps` are the same two things rather than two lists
      # that have to be kept saying the same thing.
      desktops = {
        manganese = desktop {
          name = "manganese";
          description = "The Domicile desktop: tabbed windows, a launcher, and a settings surface";
        };
        simple = desktop {
          name = "simple";
          description = "The smallest Domicile desktop: floating windows on the Alt key, Alt+Enter for a terminal";
        };
      };

      # The two desktops, as things to run rather than things to install.
      domicileApps = pkgs.lib.mapAttrs
        (name: package: {
          type = "app";
          program = pkgs.lib.getExe package;
          meta.description = package.meta.description;
        })
        desktops;

      # `nix run .#dev-<attr>` → `scripts/<script>.sh`. None of these is a
      # desktop: they are the checks and the smoke tests, for somebody working
      # on Domicile rather than running it.
      scriptApps = pkgs.lib.mapAttrs
        (name: script: {
          type = "app";
          program = pkgs.lib.getExe (runInFullShell name script);
          meta.description = "Run scripts/${script} with no checkout";
        })
        {
          check = "check.sh";
          e2e-dmabuf = "e2e-dmabuf.sh";
          e2e-chrome-fills-the-desktop = "e2e-chrome-fills-the-desktop.sh";
          smoke-compositor = "smoke-compositor.sh";
          test-out-of-tree-shell = "test-out-of-tree-shell.sh";
        };
    in
    {
      # No `default`. `nix build` on its own has nothing to build here on
      # purpose: which desktop you want is the only question this flake cannot
      # answer for you, and `.#domicile` is the runner rather than a desktop.
      packages.${system} = desktops // {
        # Domicile itself, so `nix profile install .#domicile` puts `domicile`
        # on `PATH` for somebody whose desktop is their own.
        domicile = domicileCli;
        # The engine on its own, for `nix build .#engine` and for anyone who
        # wants the path to hand to `run-engine.sh` themselves.
        engine = domicileEngine;
      };

      # WHAT `nix run` OFFERS, AND WHY IT IS THIS SHORT.
      #
      # There are two things a person wants from this flake: run a desktop, or
      # build the engine one runs on. Everything else here drives a checkout —
      # `check.sh`, the e2e scripts, the measurements — and those belong to
      # somebody who has cloned the repository, where `./scripts/<name>.sh` is
      # a shorter way to say the same thing. They stayed on the top level
      # because it cost nothing to put them there, and the cost turned out to
      # be that `nix run github:cprussin/domicile#<tab>` offers twenty things
      # and buries the two.
      #
      # They are still reachable, each prefixed `dev-`, which says who they are
      # for and keeps them sorted together underneath the three that are not.

      apps.${system} = {
        # A bare `nix run github:cprussin/domicile` is Domicile itself, taking
        # the shell to run. Not manganese, which it was: a desktop is a page
        # somebody built, and the flake having two of its own does not make
        # either of them the default answer to "run Domicile". `#manganese`
        # and `#simple` are how you ask for those.
        default = {
          type = "app";
          program = pkgs.lib.getExe domicileCli;
          meta.description = domicileCli.meta.description;
        };
        inherit (domicileApps) manganese simple;
        # No `engine` app. `nix build .#engine` is how you get the engine —
        # it is a browser, not a thing to run — and an app here would have
        # been `nix run .#engine -- manganese` launching bare Chromium with
        # `manganese` as a URL to open. That command used to work and now
        # means something else, which is worse than it not existing.
      } // pkgs.lib.mapAttrs'
        (name: app: pkgs.lib.nameValuePair "dev-${name}" app)
        scriptApps;

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

        # Full shell: adds the Wayland/DRM/GPU libraries domicile-compositor needs.
        full = pkgs.mkShell {
          packages = coreTools ++ hostLibs;
          RUST_BACKTRACE = "1";
          FORCE_COLOR = 1;
          BIOME_BINARY = pkgs.lib.getExe pkgs.biome;
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
            ]}:${pkgs.lib.makeLibraryPath engineRuntimeLibs}";
          shellHook = ''
            echo "domicile dev shell (full: +wayland +drm +gl)"
          '';
        };
      };
    };
}
