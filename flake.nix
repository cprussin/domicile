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

        # The tarball holds one directory, and that directory is the engine:
        # `chrome` sits directly inside it, which is what `DOMICILE_ENGINE`
        # names and what `libexec/domicile/engine` points at.
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
      # `domicile` starts a bridge, an engine and a compositor, and finds each
      # beside itself. A checkout builds them; these are the same three built
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
        #
        # AND THIS IS NOW THE ONLY PLACE THAT KNOWS THE NAME. `domicile` is
        # handed a module and loads that module, whatever it is called; the
        # `shell.js` constant it used to hold is gone, and with it the last
        # reason a shell outside this repository had to adopt the convention.
        # So the convention is this workspace's own, asserted here where it is
        # produced and read one derivation below where the desktop is wrapped
        # — the two halves of one build, rather than a launcher rule.
        doInstallCheck = true;
        installCheckPhase = ''
          [ -f "$out/shell.js" ] || {
            echo "${name} built no shell.js; it has:" >&2
            ls "$out" >&2
            exit 1
          }
        '';
      };

      # Domicile, laid out so that `domicile` can find the rest of itself.
      #
      #   bin/domicile
      #   bin/domicile-compositor
      #   libexec/domicile/engine     the Chromium tree, `chrome` inside it
      #
      # THE BINARIES ARE COPIED, NOT SYMLINKED, and that is the whole trick.
      # `domicile` finds its siblings from `current_exe`, which on Linux reads
      # `/proc/self/exe` and therefore *resolves symlinks*. A `bin/domicile`
      # symlinked into the Rust derivation would report that derivation's path,
      # where there is no `libexec` and never will be — so the desktop would
      # refuse to start, naming a directory nobody wrote. Copied, it reports a
      # path inside this layout, which is the one that has the other two.
      #
      # Only the binary's own path matters, so the engine under `libexec` stays
      # a symlink: nothing asks where *it* really is.
      domicilePackage = pkgs.runCommand "domicile"
        {
          meta = {
            description = "Run a Domicile desktop from a shell you built yourself";
            mainProgram = "domicile";
            platforms = [ system ];
          };
        } ''
        mkdir -p "$out/bin" "$out/libexec/domicile"
        cp ${domicileBinaries}/bin/domicile "$out/bin/domicile"
        cp ${domicileBinaries}/bin/domicile-compositor "$out/bin/domicile-compositor"
        ln -s ${domicileEngine} "$out/libexec/domicile/engine"
      '';

      # A desktop: Domicile with the module already chosen.
      #
      # A wrapper, and the only one left, because that is all a desktop is —
      # `domicile` with one argument it does not have to be told twice. It
      # `exec`s, so `current_exe` inside is the copied binary above and the
      # siblings are found from there.
      #
      # The module rather than the directory holding it, because that is what
      # `domicile` takes: a directory is refused now, with a message telling
      # whoever typed it to name the file. `shellPage`'s install check above is
      # what makes joining `shell.js` on here safe — a build that emitted
      # anything else never reaches this line.
      desktop = { name, description }:
        pkgs.runCommand name
          {
            nativeBuildInputs = [ pkgs.makeWrapper ];
            meta = {
              inherit description;
              mainProgram = name;
              platforms = [ system ];
            };
          } ''
          makeWrapper ${domicilePackage}/bin/domicile "$out/bin/${name}" \
            --add-flags ${shellPage name}/shell.js
        '';

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

      # The two Rust binaries, which no output exposes on their own.
      #
      # `domicile-compositor` is not a thing to install: it takes a chrome
      # socket and a session file on its command line and refuses to start
      # without them, so a user who ran it would get a usage error. `domicile`
      # is the thing to install, and it is installed by the layout below rather
      # than from here, because finding its siblings depends on where it sits.
      domicileBinaries = pkgs.rustPlatform.buildRustPackage {
        pname = "domicile-binaries";
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

        # `default-members` leaves `domicile-compositor` out — it is the one
        # thing in the workspace that needs a graphics stack — so it has to be
        # named.
        # Both binaries a desktop is, out of one build: `domicile` supervises
        # and `domicile-compositor` is supervised, and they land in the same
        # `bin/` — which is where `domicile` looks for the second.
        #
        # And the binaries by name, not just the packages: `domicile-compositor`
        # owns a second `[[bin]]`, `domicile-test-client`, which exists so that
        # cargo builds a Wayland client whenever it builds the tests that spawn
        # one. It is test scaffolding, and naming the binaries here is what
        # keeps it out of what this package installs.
        cargoBuildFlags = [
          "-p" "domicile-compositor" "--bin" "domicile-compositor"
          "-p" "domicile-launch" "--bin" "domicile"
        ];

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
        outputHash = "sha256-hMf+Q55hPpk6tHQedu8esLtRx4FookKMoVuBIatn5Gk=";
      };


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
    in
    {
      # No `default`. `nix build` on its own has nothing to build here on
      # purpose: which desktop you want is the only question this flake cannot
      # answer for you, and `.#domicile` is the runner rather than a desktop.
      packages.${system} = desktops // {
        # Domicile itself, so `nix profile install .#domicile` puts `domicile`
        # on `PATH` for somebody whose desktop is their own.
        domicile = domicilePackage;
        # The engine on its own, for `nix build .#engine` and for anyone who
        # wants a path to put in `DOMICILE_ENGINE` themselves.
        engine = domicileEngine;
      };

      # WHAT `nix run` OFFERS, AND WHY IT IS THIS SHORT.
      #
      # There are two things a person wants from this flake: run a desktop, or
      # build the engine one runs on. Everything else here drives a checkout —
      # `check.sh`, the e2e scripts, the measurements — and those belong to
      # somebody who has cloned the repository, where `./scripts/<name>.sh` is
      # a shorter way to say the same thing.
      #
      # There were five `dev-*` apps over those scripts, and they are gone.
      # They existed to run a check with no checkout, which took staging the
      # store's read-only source into the user's cache and building there —
      # seventy lines nothing ran. Not CI, which checks out and runs
      # `./scripts/check.sh` in `nix develop .#full`; not a person with a
      # checkout, for whom `./scripts/<name>.sh` is shorter. `nix develop`
      # alone cannot replace them — it hands over the *environment*, not the
      # source, and leaves you in your own directory — and the honest answer
      # to that is `git clone`, not seventy lines of staging that nothing
      # exercises.

      apps.${system} = {
        # A bare `nix run github:cprussin/domicile` is Domicile itself, taking
        # the shell to run. Not manganese, which it was: a desktop is a page
        # somebody built, and the flake having two of its own does not make
        # either of them the default answer to "run Domicile". `#manganese`
        # and `#simple` are how you ask for those.
        default = {
          type = "app";
          program = pkgs.lib.getExe domicilePackage;
          meta.description = domicilePackage.meta.description;
        };
        inherit (domicileApps) manganese simple;
        # No `engine` app. `nix build .#engine` is how you get the engine —
        # it is a browser, not a thing to run — and an app here would have
        # been `nix run .#engine -- manganese` launching bare Chromium with
        # `manganese` as a URL to open. That command used to work and now
        # means something else, which is worse than it not existing.
      };

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
