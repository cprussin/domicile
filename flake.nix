{
  description = "Domicile — a Wayland compositor whose renderer is a web engine";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };

      # Tools to build and test the pure-logic Rust crates and the TypeScript
      # workspace. No graphics libraries, so `nix develop` stays fast.
      coreTools = with pkgs; [
        cargo
        rustc
        rustfmt
        clippy
        rust-analyzer
        pkg-config
        # bun runs packages and tests, biome lints and formats. turbo comes
        # from the lockfile via `bun install`. Node matches package.json's
        # `engines.node` (>=24).
        bun
        biome
        nodejs_24
        # For the engine release scripts (`scripts/update-engine-release.sh`,
        # `.github/scripts/engine-release-*.sh`) and `spike-iframe.sh`. In the
        # core shell because the release workflow runs there.
        curl
        jq
        zstd
        # This curl shadows the system's and reads CAs from OpenSSL's default
        # path, which is empty on Fedora- and SUSE-style hosts. cacert's setup
        # hook exports `NIX_SSL_CERT_FILE` to fix that. Setting `SSL_CERT_FILE`
        # on the shell does not work: nix drops it.
        cacert
      ];

      # Native libraries the compositor needs: Smithay's Wayland stack, plus GL
      # and DRM for dmabuf import. Only in `nix develop .#full`, so the core
      # shell stays small.
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
        # `wl-copy` and `wl-paste`, the data-control clients the clipboard
        # checks run.
        wl-clipboard
        # `dbus-daemon`, a private session bus for the portal checks
        # (`packages/domicile-compositor/tests/`).
        dbus
        # The terminal the demo shell's Alt+Enter binding launches.
        kitty
        # A display for the compositor's `--present` window in headless e2e
        # tests (`e2e-a-dense-display.sh`, `e2e-chrome-fills-a-window.sh`).
        xvfb
        # Resizes Domicile's window under Xvfb, which has no window manager.
        # `e2e-chrome-fills-a-window.sh` skips without it.
        xdotool
        # libpipewire for screen casting, and the daemon
        # `e2e-a-window-casts-to-pipewire.sh` starts.
        pipewire
        # libclang, which the `pipewire` crate's bindings are generated with.
        rustPlatform.bindgenHook
      ];

      # Runtime libraries for the prebuilt Chromium engine
      # (`libdomicile_engine.so`).
      #
      # The compositor `dlopen`s the engine, so these must be on the loader
      # path of the shell the compositor runs in. Kept apart from `hostLibs`
      # because they track Chromium (`packages/domicile-engine/CHROMIUM_PIN`),
      # not Domicile.
      engineRuntimeLibs = with pkgs; [
        glib
        nss
        nspr
        dbus
        # Also provides `atk` and `at-spi2-atk`, which are aliases of it.
        at-spi2-core
        cups
        expat
        alsa-lib
        pango
        cairo
        gdk-pixbuf
        gtk3
        libdrm
        # libgbm.so.1, for GPU buffer allocation.
        libgbm
        # libinput.so.10, for trackpad input (`use_libinput = true`). Linked,
        # not `dlopen`ed, so `autoPatchelfHook` fails the build without it.
        libinput
        libxshmfence
        # libudev.so.1, to enumerate input and GPU devices. `udev` is an alias
        # of this package.
        systemd
        # X client libraries. Chromium picks its ozone platform at runtime, so
        # these must resolve even when it does not run on X.
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
      # `autoPatchelfHook` makes the generic-linux build start on NixOS.
      # `dontStrip` because stripping a large release binary gains nothing.
      # `autoPatchelfIgnoreMissingDeps` is unset so a missing library fails
      # the build, not the desktop.
      #
      # Uses the production build of this series when one exists, else the
      # checked build. See engine-pin.nix.
      engineRelease = import ./packages/domicile-engine/engine-pin.nix {
        checked = import ./packages/domicile-engine/engine-release.nix;
        official =
          let file = ./packages/domicile-engine/engine-official.nix;
          in if builtins.pathExists file then import file else null;
      };
      domicileEngine = pkgs.stdenv.mkDerivation {
        pname = "domicile-engine";
        version = builtins.substring 0 7 engineRelease.commit;

        src = pkgs.fetchurl { inherit (engineRelease) url hash; };

        nativeBuildInputs = [ pkgs.autoPatchelfHook pkgs.zstd pkgs.makeWrapper ];
        buildInputs = engineRuntimeLibs;
        dontStrip = true;

        # The tarball holds one directory: the engine, with `chrome` directly
        # inside. `DOMICILE_ENGINE` and `libexec/domicile/engine` point at it.
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

        # Chromium `dlopen`s `libEGL.so.1` at run time, which
        # `autoPatchelfHook` cannot see. Without it on the path the GPU process
        # exits and the window stays white.
        #
        # A wrapper, not an rpath: chrome re-execs itself for its zygote and
        # renderers, and only environment variables reach those children.
        # `/run/opengl-driver/lib` comes first so NixOS uses the driver
        # matching its kernel; the nixpkgs libraries cover other hosts.
        #
        # GIO finds GSettings schemas through `XDG_DATA_DIRS`, and nixpkgs
        # installs them where host data dirs never look. Without them every
        # start logs a GLib-GIO-CRITICAL. Prefixed, so host dirs still follow.
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
            }" \
            --prefix XDG_DATA_DIRS : "${
              pkgs.lib.concatMapStringsSep ":" pkgs.glib.getSchemaDataDirPath [
                pkgs.gsettings-desktop-schemas
                pkgs.gtk3
              ]
            }"
        '';

        # Fail the build, not the desktop, if a release lacks a file consumers
        # look up by name.
        doInstallCheck = true;
        installCheckPhase = ''
          for needed in chrome libdomicile_engine.so; do
            [ -e "$out/$needed" ] || {
              echo "the published engine has no $needed" >&2
              exit 1
            }
          done
          # Run through the wrapper, as every caller does.
          "$out/chrome" --version
          # Check `chrome` is the wrapper. If the `mv` failed, the unwrapped
          # binary still passes `--version` but loses its GPU process at run
          # time.
          grep -q LD_LIBRARY_PATH "$out/chrome" || {
            echo "the engine's chrome is not wrapped, so it carries no GL path" >&2
            exit 1
          }
          # Check the wrapper adds compiled GSettings schemas.
          schemas=$(grep -o "[^:\"']*/share/gsettings-schemas/[^:\"']*" "$out/chrome" || true)
          [ -n "$schemas" ] || {
            echo "the engine's chrome carries no GSettings schemas" >&2
            exit 1
          }
          for dir in $schemas; do
            [ -e "$dir/glib-2.0/schemas/gschemas.compiled" ] || {
              echo "$dir has no compiled GSettings schemas" >&2
              exit 1
            }
          done
        '';

        meta = {
          description =
            "The patched Chromium domicile-compositor uses as its engine";
          # Chromium's license; see packages/domicile-engine/LICENSE.
          license = pkgs.lib.licenses.bsd3;
        };
      };

      # ── The three things a desktop is made of ───────────────────────────
      #
      # `domicile` starts a bridge, an engine and a compositor, and finds each
      # beside itself. These build them in the store so `nix run` starts a
      # desktop without building.

      # A shell's web page: only the renderer bundle. `build:vite`'s launcher,
      # main and preload bundles are for running a shell outside a browser.
      shellPage = name: pkgs.stdenv.mkDerivation {
        pname = "domicile-page-${name}";
        version = "0.0.0";
        src = self;
        nativeBuildInputs = [ pkgs.bun pkgs.nodejs_24 ];
        configurePhase = sharedShellConfigure;
        buildPhase = ''
          runHook preBuild
          node_modules/.bin/turbo build:vite \
            --filter "./packages/shell-${name}" --no-daemon
          runHook postBuild
        '';
        # `main_window` is the window name in the shell's `vite.config.ts`.
        installPhase = ''
          runHook preInstall
          cp -R "packages/shell-${name}/.vite/renderer/main_window" "$out"
          runHook postInstall
        '';
        # Fail the build if there is no entry module; at run time that shows
        # only as a blank screen.
        #
        # A shell is a module and Domicile writes the document.
        # `@domicile-desktop/component-library/vite-shell` fixes the entry name
        # as `shell.js`. `domicile` accepts any module name, so this check and
        # `desktop` below are the only places that rely on it.
        doInstallCheck = true;
        installCheckPhase = ''
          [ -f "$out/shell.js" ] || {
            echo "${name} built no shell.js; it has:" >&2
            ls "$out" >&2
            exit 1
          }
        '';
      };

      # The built workspace a shell is built against: the builder's
      # `--domicile`, from which it resolves manganese and React. Laid out like
      # this repository, because that is the layout the builder reads.
      #
      # Copies every package with a `package.json`: each `node_modules` links
      # its workspace siblings, and the fixup rejects dangling links.
      shellWorkspace = pkgs.stdenv.mkDerivation {
        pname = "domicile-shell-workspace";
        version = "0.0.0";
        src = self;
        nativeBuildInputs = [ pkgs.bun pkgs.nodejs_24 ];
        configurePhase = sharedShellConfigure;
        buildPhase = ''
          runHook preBuild
          node_modules/.bin/turbo run prepare build \
            --filter "@domicile-desktop/manganese..." --no-daemon
          runHook postBuild
        '';
        installPhase = ''
          runHook preInstall
          mkdir -p "$out/packages"
          cp -a package.json node_modules "$out/"
          for manifest in packages/*/package.json; do
            cp -a "$(dirname "$manifest")" "$out/packages/"
          done
          runHook postInstall
        '';
      };

      # The program `domicile` builds a shell with, from an entry or a
      # package. A script, because the builder is TypeScript run by bun.
      domicileBuilder = pkgs.writeShellScript "domicile-builder" ''
        exec ${pkgs.bun}/bin/bun ${shellWorkspace}/packages/domicile-builder/src/main.ts \
          --domicile ${shellWorkspace} "$@"
      '';

      # Domicile, laid out so that `domicile` can find the rest of itself.
      #
      #   bin/domicile
      #   bin/domicile-compositor
      #   bin/domicile-open-url       what `BROWSER` names inside a desktop
      #   bin/domicile-xdg-open       what `xdg-open` is inside a desktop
      #   libexec/domicile/engine     the Chromium tree, `chrome` inside it
      #   libexec/domicile/builder    builds a shell from an entry or a package
      #   libexec/domicile/shells/    Domicile's prebuilt shells, which
      #                               `@domicile-desktop/manganese` names,
      #                               and the splash
      #
      # The binaries are copied, not symlinked. `domicile` finds its siblings
      # from `current_exe`, which resolves symlinks, so a symlink would point
      # into the Rust derivation where there is no `libexec`. The engine can
      # stay a symlink because nothing resolves its path.
      domicilePackage = pkgs.runCommand "domicile"
        {
          # The login session. `domicile` with no shell argument runs the
          # shell its config names. NixOS's `sessionPackages` requires
          # `providedSessions`. The display manager sets `XDG_CURRENT_DESKTOP`
          # from `DesktopNames`. No `OZONE`: the session runs on a VT, and
          # `XDG_VTNR` already selects the drm platform.
          passthru.providedSessions = [ "domicile" ];
          meta = {
            description = "Run a Domicile desktop from a shell you built yourself";
            license = pkgs.lib.licenses.mit;
            mainProgram = "domicile";
            platforms = [ system ];
          };
        } ''
        mkdir -p "$out/bin" "$out/libexec/domicile"
        cp ${domicileBinaries}/bin/domicile "$out/bin/domicile"
        cp ${domicileBinaries}/bin/domicile-compositor "$out/bin/domicile-compositor"
        # `BROWSER` inside a desktop. Copied for the same reason as above.
        cp ${domicileBinaries}/bin/domicile-open-url "$out/bin/domicile-open-url"
        # `xdg-open` inside a desktop, first on every app's PATH.
        cp ${domicileBinaries}/bin/domicile-xdg-open "$out/bin/domicile-xdg-open"
        # Registers `domicile-open-url` as the web link handler, so links open
        # in a browser window of the current desktop. Hidden from launchers.
        mkdir -p "$out/share/applications"
        cat >"$out/share/applications/domicile-open-url.desktop" <<DESKTOP
        [Desktop Entry]
        Type=Application
        Name=Domicile
        Comment=Open a link in a browser window of this desktop
        Exec=$out/bin/domicile-open-url %u
        MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
        NoDisplay=true
        DESKTOP
        # Makes that handler the default. GIO and `xdg-open` read this file
        # only when `XDG_CURRENT_DESKTOP` is `domicile`, and `domicile` puts
        # this `share` first in every app's `XDG_DATA_DIRS`. A user's own
        # `mimeapps.list` still takes precedence.
        cat >"$out/share/applications/domicile-mimeapps.list" <<MIMEAPPS
        [Default Applications]
        text/html=domicile-open-url.desktop
        x-scheme-handler/http=domicile-open-url.desktop
        x-scheme-handler/https=domicile-open-url.desktop
        MIMEAPPS
        ln -s ${domicileEngine} "$out/libexec/domicile/engine"
        cp ${domicileBuilder} "$out/libexec/domicile/builder"
        mkdir -p "$out/libexec/domicile/shells"
        ln -s ${shellPage "manganese"} "$out/libexec/domicile/shells/manganese"
        ln -s ${shellPage "simple"} "$out/libexec/domicile/shells/simple"
        # What a desktop shows while it builds its shell on first start.
        ln -s ${shellPage "splash"} "$out/libexec/domicile/shells/splash"
        # Tells `xdg-desktop-portal` which interfaces Domicile implements. The
        # compositor owns the D-Bus name and sets the matching
        # `XDG_CURRENT_DESKTOP` on clients.
        mkdir -p "$out/share/xdg-desktop-portal/portals"
        cp ${./nix/domicile.portal} \
          "$out/share/xdg-desktop-portal/portals/domicile.portal"
        # Routes portal calls (xdg-desktop-portal >= 1.17): Domicile for
        # everything but `Secret`, which goes to the keyring.
        cp ${./nix/domicile-portals.conf} \
          "$out/share/xdg-desktop-portal/domicile-portals.conf"
        # The user target the login session starts. It binds
        # `graphical-session.target`, which the portal requires.
        mkdir -p "$out/lib/systemd/user"
        cp ${./nix/domicile-session.target} \
          "$out/lib/systemd/user/domicile-session.target"
        cp ${./nix/domicile-session-shutdown.target} \
          "$out/lib/systemd/user/domicile-session-shutdown.target"
        mkdir -p "$out/share/wayland-sessions"
        cat >"$out/share/wayland-sessions/domicile.desktop" <<DESKTOP
        [Desktop Entry]
        Type=Application
        Name=Domicile
        Comment=The desktop your config names
        Exec=$out/bin/domicile
        DesktopNames=domicile
        DESKTOP
      '';

      # A desktop: `domicile` wrapped with a prebuilt shell module. The wrapper
      # `exec`s, so `current_exe` is still the copied binary above.
      #
      # `domicile` takes the module file, not its directory. `shellPage`'s
      # install check guarantees `shell.js` exists.
      #
      # Adds kitty to `PATH` because `simple` binds Alt+Return to
      # `domicile.spawn(["kitty"])`. `--suffix`, so a user's own kitty wins.
      # `manganese` binds no terminal.
      desktop = { name, description }:
        pkgs.runCommand name
          {
            nativeBuildInputs = [ pkgs.makeWrapper ];
            meta = {
              inherit description;
              license = pkgs.lib.licenses.mit;
              mainProgram = name;
              platforms = [ system ];
            };
          } ''
          # `--add-flags` puts the page first. That is fine here because this
          # binary has no subcommands; the home-manager module's `domicile`
          # does, so it appends the shell instead.
          makeWrapper ${domicilePackage}/bin/domicile "$out/bin/${name}" \
            --add-flags ${shellPage name}/shell.js \
            --suffix PATH : ${pkgs.lib.makeBinPath [ pkgs.kitty ]}
        '';

      # ── What a user installs ────────────────────────────────────────────
      #
      # - `.#manganese`, `.#simple`: Domicile with one of this repository's
      #   shells.
      # - `.#domicile`: Domicile alone; takes the path to a built shell.
      #
      # There is no default package because the flake cannot pick a desktop
      # for you. The default `nix run` app is `domicile`, which takes a shell.

      # Every package with a `Cargo.toml`.
      rustCrates = builtins.attrNames (pkgs.lib.filterAttrs
        (name: _: builtins.pathExists (./packages + "/${name}/Cargo.toml"))
        (builtins.readDir ./packages));

      # The Rust binaries. Not an output: `domicile-compositor` is only started
      # by `domicile`, and `domicile` must be installed in `domicilePackage`'s
      # layout to find its siblings.
      domicileBinaries = pkgs.rustPlatform.buildRustPackage {
        pname = "domicile-binaries";
        version = "0.0.0";
        # Include everything cargo can reach, not only `.rs` files:
        # `include_str!` reads shaders, and tests read `scripts/` and
        # `ROADMAP.md`. A narrower filter breaks with only "file missing".
        src = pkgs.lib.fileset.toSource {
          root = ./.;
          fileset = pkgs.lib.fileset.unions
            ([ ./Cargo.toml ./Cargo.lock ./ROADMAP.md ./scripts ]
              ++ map (name: ./packages + "/${name}") rustCrates);
        };
        cargoLock.lockFile = ./Cargo.lock;

        nativeBuildInputs = [
          pkgs.pkg-config
          pkgs.makeWrapper
          # libclang, for the `pipewire` crate's bindings.
          pkgs.rustPlatform.bindgenHook
        ];
        # libxkbcommon and libpipewire are linked. Smithay's winit and EGL code
        # probes for the rest at build time; `postFixup` makes them loadable at
        # run time.
        buildInputs = with pkgs; [ libxkbcommon wayland libGL libgbm pipewire ];

        # `domicile-compositor` must be named because `default-members` omits
        # it. Binaries are named too, so the test-only `domicile-test-client`
        # binary is not installed.
        cargoBuildFlags = [
          "-p" "domicile-compositor" "--bin" "domicile-compositor"
          "-p" "domicile-launch" "--bin" "domicile" "--bin" "domicile-open-url" "--bin" "domicile-xdg-open"
        ];

        # CI's `cargo-test` job runs the tests on every push; repeating them
        # per install only costs time.
        doCheck = false;

        # Add `dlopen`ed libraries to the rpath: libEGL for dmabuf import, the
        # Wayland and X11 client libraries winit probes, and libpam for the
        # lock screen's `lock.pam_service`. `/run/opengl-driver/lib` comes
        # first so NixOS uses the EGL matching its kernel driver.
        #
        # - `DOMICILE_PNP_IDS`: hwdata's EDID vendor table. Read at run time,
        #   not vendored, because it is GPL-2+.
        # - `PATH`, after the user's own: PulseAudio's `pactl` and `parec`,
        #   which the shell's mixer spawns (PipeWire systems may have none),
        #   and `curl`, which shells spawn to fetch bookmark icons
        #   (`@domicile-desktop/system-apps/curl`).
        #
        # `--set-default` and `--suffix` so a user's own value wins.
        postFixup = ''
          patchelf --add-rpath "${pkgs.lib.makeLibraryPath (with pkgs; [
            libGL mesa libgbm wayland libxkbcommon
            libx11 libxcursor libxrandr libxi
            pam
          ])}" "$out/bin/domicile-compositor"
          wrapProgram "$out/bin/domicile-compositor" \
            --prefix LD_LIBRARY_PATH : "/run/opengl-driver/lib" \
            --set-default DOMICILE_PNP_IDS "${pkgs.hwdata}/share/hwdata/pnp.ids" \
            --suffix PATH : "${pkgs.lib.makeBinPath [ pkgs.pulseaudio pkgs.curl ]}"
        '';
      };

      # Everything `bun install` fetches, as one fixed-output derivation.
      #
      # `src` holds only the manifests, so editing source does not refetch.
      # Install scripts are skipped so the result is reproducible.
      #
      # Update `outputHash` by hand whenever `bun.lock` changes. A stale hash
      # fails only on a store that has not built this path before; elsewhere
      # nix silently reuses the old modules. CI
      # (`.github/workflows/nix-build.yml`) builds on a cold store and
      # catches it.
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
        # Copy every `node_modules`, root and per package, at its original
        # depth. Some tools (`panda`, `tsc`) live only in per-package trees,
        # and the relative symlinks inside resolve only at the same depth.
        installPhase = ''
          runHook preInstall
          rm -rf node_modules/.cache
          # Keep the output hash stable. `bun install` sometimes links an
          # extra `.bin` entry inside its internal store (about one run in
          # six). Nothing uses those directories, so drop them.
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
        outputHash = "sha256-0Vd81Tb6iaiHVXNi8GxuzZTftVqPop96t9lDkclPJyQ=";
      };


      # Prepares a workspace build to run turbo: writable modules, patched
      # shebangs and turbo's writable directories. Shared by every derivation
      # that builds the workspace.
      sharedShellConfigure = ''
            runHook preConfigure
            cp -a "${nodeModules}/node_modules" node_modules
            for tree in "${nodeModules}"/packages/*/node_modules; do
              cp -a "$tree" "packages/$(basename "$(dirname "$tree")")/node_modules"
            done
            chmod -R u+w node_modules packages/*/node_modules
            # The sandbox has no `/usr/bin/env`, so `#!/usr/bin/env node`
            # shims fail with `bad interpreter`. Point them at the store's node.
            patchShebangs node_modules packages/*/node_modules
            export HOME="$TMPDIR"
            # Stops `//#build:install-modules` from running `bun install`;
            # there is no network, and the modules are already in place.
            export CI=1
            # turbo writes a cache and telemetry state; only $TMPDIR is
            # writable.
            export TURBO_CACHE_DIR="$TMPDIR/turbo"
            export TURBO_TELEMETRY_DISABLED=1
            runHook postConfigure
          '';

      # The desktops this repository ships, shared by `packages` and `apps`.
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

      # The desktops as `nix run` apps.
      domicileApps = pkgs.lib.mapAttrs
        (name: package: {
          type = "app";
          program = pkgs.lib.getExe package;
          meta.description = package.meta.description;
        })
        desktops;
    in
    {
      # Home-manager module for configuring Domicile alongside the rest of a
      # user's environment.
      #
      # Not per-system: the module reads `pkgs` from the importing
      # configuration. It gets this flake's `packages` as the default package,
      # which users can override.
      #
      # The login session and the lock screen's PAM service are machine
      # settings, so they live in `nixosModules`.
      homeManagerModules = rec {
        domicile = import ./nix/home-manager.nix {
          domicilePackages = self.packages.${system};
        };
        # `default` for `imports = [domicile.homeManagerModules.default]`;
        # `domicile` for configurations that import several flakes' modules.
        default = domicile;
      };

      # NixOS module for the machine-level settings.
      nixosModules = rec {
        domicile = import ./nix/nixos.nix {
          domicilePackages = self.packages.${system};
        };
        default = domicile;
      };

      # No `default`: the flake cannot choose a desktop for you.
      packages.${system} = desktops // {
        # Domicile alone, for users with their own shell.
        domicile = domicilePackage;
        # The engine alone, for setting `DOMICILE_ENGINE` yourself.
        engine = domicileEngine;
        # The shell builder on its own, for `DOMICILE_BUILDER`.
        builder = domicileBuilder;
      };

      # `nix run` offers only running a desktop and building the engine.
      # Checks, e2e scripts and measurements need a checkout; run them as
      # `./scripts/<name>.sh`.

      # `nix flake check` evaluates the two modules, which nothing else does.
      #
      # `scripts/test-the-home-manager-module-agrees.sh` checks option names
      # against the Rust schema without nix. These checks cover types,
      # defaults and the generated config JSON.
      #
      # The home-manager check stubs the few options the module sets outside
      # its namespace, instead of adding home-manager as an input and its
      # closure to every check. `xdg.mimeApps` is left out so that setting it
      # is an evaluation error.
      checks.${system} = {
        home-manager-module =
          let
            stub = { lib, ... }: {
              options = {
                home.packages = lib.mkOption {
                  type = lib.types.listOf lib.types.package;
                  default = [ ];
                };
                xdg.configFile = lib.mkOption {
                  type = lib.types.attrsOf (lib.types.submodule {
                    options.source = pkgs.lib.mkOption { type = pkgs.lib.types.path; };
                  });
                  default = { };
                };
                # Where a removed option names its replacement.
                assertions = lib.mkOption {
                  type = lib.types.listOf lib.types.unspecified;
                  default = [ ];
                };
                warnings = lib.mkOption {
                  type = lib.types.listOf lib.types.str;
                  default = [ ];
                };
                xdg.portal.extraPortals = lib.mkOption {
                  type = lib.types.listOf lib.types.package;
                  default = [ ];
                };
                xdg.portal.configPackages = lib.mkOption {
                  type = lib.types.listOf lib.types.package;
                  default = [ ];
                };
              };
            };
            # A config using each part of the schema: a rotated monitor at a
            # fractional scale, a disabled one, a described display and a
            # keyboard.
            desk = { ... }: {
              programs.domicile = {
                enable = true;
                shell = "${desktops.simple}/shell.js";
                settings = {
                  input.keyboard = {
                    xkb_layout = "us";
                    xkb_variant = "dvp";
                    xkb_options = [ "caps:escape" ];
                  };
                  output = {
                    max_scale = 2;
                    displays = [{
                      name = "nested";
                      position = [ 0 0 ];
                      size = [ 1920 1080 ];
                      scale = 1;
                    }];
                    profiles = [{
                      name = "desk";
                      displays = [
                        { display = "drm-1"; enabled = false; }
                        {
                          display = "DEL DELL U3219Q 2ZLS413";
                          mode = [ 3840 2160 ];
                          position = [ 0 0 ];
                          scale = 1.2;
                          transform = "rotate-270";
                        }
                      ];
                    }];
                  };
                };
              };
            };
            evaluated = pkgs.lib.evalModules {
              modules = [ stub self.homeManagerModules.domicile desk ];
              specialArgs = { inherit pkgs; };
            };
            written = evaluated.config.xdg.configFile."domicile/domicile.json".source;

            # The module with settings of its own on top of `desk`.
            deskWith = settings: pkgs.lib.evalModules {
              modules = [ stub self.homeManagerModules.domicile desk { programs.domicile.settings = settings; } ];
              specialArgs = { inherit pkgs; };
            };

            # A removed setting fails an assertion that says where it went.
            removedSettingSaysWhere = pkgs.lib.any
              (each: !each.assertion && pkgs.lib.hasInfix "manganese" each.message)
              (deskWith { applications.omit = [ "*" ]; }).config.assertions;

            # A config the compositor refuses fails to build, so it never
            # reaches a desk. Its log is the compositor's reason.
            refused = pkgs.testers.testBuildFailure
              (deskWith { no_such_section = { }; }).config.xdg.configFile."domicile/domicile.json".source;

            # The same module with a `domicile` that prints its arguments, to
            # test the wrapper's command lines. The real binary needs a
            # compositor, which the sandbox lacks.
            sawArgs = pkgs.lib.evalModules {
              modules = [
                stub
                self.homeManagerModules.domicile
                desk
                { programs.domicile.package = pkgs.writeShellScriptBin "domicile" ''printf '%s\n' "$@"''; }
              ];
              specialArgs = { inherit pkgs; };
            };
          in
          pkgs.runCommand "home-manager-module-evaluates" { nativeBuildInputs = [ pkgs.jq ]; } ''
            # Assert values at their keys with `jq`, independent of how
            # `pkgs.formats.json` formats the file.
            cp ${written} config.json
            expect() {
              jq -e "$1" config.json >/dev/null || {
                echo "the module did not write: $1" >&2
                echo "--- what it wrote ---" >&2
                cat config.json >&2
                exit 1
              }
            }
            expect '.input.keyboard.xkb_variant == "dvp"'
            expect '.input.keyboard.xkb_options == ["caps:escape"]'
            expect '.output.max_scale == 2'
            expect '.output.profiles[0].name == "desk"'
            expect '.output.profiles[0].displays[0] | .display == "drm-1" and .enabled == false'
            expect '.output.profiles[0].displays[1] | .scale == 1.2 and .transform == "rotate-270"'
            # The shell is also written to the config, so the login session,
            # which runs `domicile` without the wrapper, uses it too.
            expect '.shell == "${desktops.simple}/shell.js"'

            # No nulls: `domicile` rejects a null for most keys, and one bad
            # key rejects the whole file. The desk sets `mode` on only one
            # display, so this checks that `withoutNulls` recurses into lists.
            expect '[.. | select(. == null)] | length == 0'

            # A mode that is set reaches the file.
            expect '.output.profiles[0].displays[1].mode == [3840, 2160]'

            grep -qF 'unknown field `no_such_section`' ${refused}/testBuildFailure.log || {
              echo "a config domicile refuses did not fail to build over it:" >&2
              cat ${refused}/testBuildFailure.log >&2
              exit 1
            }

            [ ${pkgs.lib.boolToString removedSettingSaysWhere} = true ] || {
              echo "setting programs.domicile.settings.applications fails no assertion naming manganese" >&2
              exit 1
            }

            # Check the arguments the wrapped `domicile` receives. The shell
            # must go last, because a subcommand is recognized only as the
            # first argument.
            domicile=${sawArgs.config.programs.domicile.finalPackage}/bin/domicile

            saw() { # what was typed -> what reached the binary
              want="$1"; shift
              got="$("$domicile" "$@" | tr '\n' ' ')"
              [ "$got" = "$want " ] || {
                echo "domicile $* reached the binary as: $got" >&2
                echo "and it should have been: $want" >&2
                exit 1
              }
            }

            # No arguments: the configured shell.
            saw "${desktops.simple}/shell.js"
            # A subcommand passes through unchanged.
            saw "which-shell" which-shell
            # `load-shell`'s argument is not a shell to run, so nothing is
            # appended.
            saw "load-shell ./other.js" load-shell ./other.js
            # An explicit shell overrides the configured one.
            saw "./other.js" ./other.js
            # `--config`'s path is not a shell, so the configured shell is
            # still appended.
            saw "--config /tmp/x ${desktops.simple}/shell.js" --config /tmp/x

            # `open-url` takes an address, so nothing is appended.
            saw "open-url https://example.com" open-url https://example.com
            # Nor to `screenshot`'s file or `check-config`'s config.
            saw "screenshot shot.png" screenshot shot.png
            saw "check-config domicile.json" check-config domicile.json

            # The default-browser file ships in Domicile's `share`, which
            # `domicile` puts first in `XDG_DATA_DIRS`. The module must not
            # write one into the home.
            [ ${pkgs.lib.boolToString (evaluated.config.xdg.configFile ? "domicile-mimeapps.list")} = false ] || {
              echo "the module still writes domicile-mimeapps.list into the home" >&2
              exit 1
            }
            mimeapps=${domicilePackage}/share/applications/domicile-mimeapps.list
            for line in \
              '[Default Applications]' \
              'text/html=domicile-open-url.desktop' \
              'x-scheme-handler/http=domicile-open-url.desktop' \
              'x-scheme-handler/https=domicile-open-url.desktop'
            do
              grep -qxF "$line" "$mimeapps" || {
                echo "domicile's own domicile-mimeapps.list is missing: $line" >&2
                cat "$mimeapps" >&2
                exit 1
              }
            done

            # The module adds Domicile's portal backend and its
            # `domicile-portals.conf` to `xdg.portal` without enabling
            # portals, and offers no gtk backend.
            [ ${pkgs.lib.boolToString (pkgs.lib.elem pkgs.xdg-desktop-portal-gtk evaluated.config.xdg.portal.extraPortals)} = false ] || {
              echo "xdg.portal.extraPortals still offers xdg-desktop-portal-gtk" >&2
              exit 1
            }
            ${pkgs.lib.concatMapStrings ({ option, package }: ''
              [ ${pkgs.lib.boolToString (pkgs.lib.elem package evaluated.config.xdg.portal.${option})} = true ] || {
                echo "xdg.portal.${option} does not hold ${package.name}" >&2
                exit 1
              }
            '') [
              { option = "extraPortals"; package = evaluated.config.programs.domicile.finalPackage; }
              { option = "configPackages"; package = evaluated.config.programs.domicile.finalPackage; }
            ]}

            touch "$out"
          '';

        # `nix/removed-settings.nix` on its own, with paths the real module does
        # not list: one at the top, one in a section, one in a list's elements.
        removed-settings =
          let
            lib = pkgs.lib;
            removed = import ./nix/removed-settings.nix { inherit lib; } {
              gone = "top note";
              "section.gone" = "section note";
              "items[].gone" = "item note";
            };
            evaluate = settings: (lib.evalModules {
              modules = [
                ({ config, ... }: {
                  options.assertions = lib.mkOption { type = lib.types.listOf lib.types.unspecified; };
                  options.settings = lib.mkOption {
                    type = lib.types.submodule {
                      freeformType = (pkgs.formats.json { }).type;
                      options = lib.recursiveUpdate {
                        section.kept = lib.mkOption { default = 1; };
                        items = lib.mkOption {
                          type = lib.types.listOf (lib.types.submodule {
                            options = lib.recursiveUpdate
                              { kept = lib.mkOption { default = 1; }; }
                              (removed.optionsUnder "items[]");
                          });
                          default = [ ];
                        };
                      } (removed.optionsUnder "");
                    };
                    default = { };
                  };
                  config.assertions = removed.assertions config.settings;
                })
                { inherit settings; }
              ];
            }).config;
            # The notes of the assertions that fail.
            failing = settings: map (each: each.message)
              (lib.filter (each: !each.assertion) (evaluate settings).assertions);
            expect = what: holds: lib.optionalString (!holds) "echo ${lib.escapeShellArg "removed-settings: ${what}"} >&2; exit 1\n";
            unset = evaluate { items = [ { } ]; };
          in
          pkgs.runCommandLocal "removed-settings" { } ''
            ${expect "nothing set fails nothing" (failing { items = [ { } ]; } == [ ])}
            ${expect "an unset removed setting is null" (unset.settings.gone == null && unset.settings.section.gone == null && (lib.head unset.settings.items).gone == null)}
            ${expect "a removed setting at the top fails with its note" (failing { gone = 1; } == [ "programs.domicile.settings.gone is removed. top note" ])}
            ${expect "a removed setting in a section fails with its note" (failing { section.gone = 1; } == [ "programs.domicile.settings.section.gone is removed. section note" ])}
            ${expect "a removed setting in a list's element fails with its note" (failing { items = [ { } { gone = 1; } ]; } == [ "programs.domicile.settings.items[].gone is removed. item note" ])}
            touch "$out"
          '';

        # The NixOS module, evaluated with real NixOS instead of a stub, since
        # NixOS's own checks (such as `sessionPackages` requiring
        # `providedSessions`) are what is under test. Evaluation builds no
        # system.
        nixos-module =
          let
            machine = pkgs.nixos {
              imports = [ self.nixosModules.domicile ];
              programs.domicile.enable = true;
              # The module does not enable a display manager itself.
              services.displayManager.enable = true;
              # The minimum a NixOS configuration needs to evaluate.
              boot.loader.grub.enable = false;
              fileSystems."/" = {
                device = "nodev";
                fsType = "tmpfs";
              };
              system.stateVersion = pkgs.lib.trivial.release;
            };
            # The sessions the display manager receives. NixOS rejects a
            # package missing the file its `providedSessions` names.
            inherit (machine.config.services.displayManager.sessionData) sessionNames;
            session = "${machine.config.services.displayManager.sessionData.desktops}/share/wayland-sessions/domicile.desktop";
          in
          pkgs.runCommand "nixos-module-evaluates" { } ''
            # One session, `domicile`; the config chooses the shell.
            [ ${pkgs.lib.escapeShellArg (toString sessionNames)} = domicile ] || {
              echo "the sessions NixOS sees are: ${toString sessionNames}" >&2
              echo "and they should have been: domicile" >&2
              exit 1
            }
            # The display manager sets `XDG_CURRENT_DESKTOP` from
            # `DesktopNames` before the compositor starts.
            for line in 'Exec=${domicilePackage}/bin/domicile' 'DesktopNames=domicile'; do
              grep -qxF "$line" ${session} || {
                echo "the domicile session is missing: $line" >&2
                cat ${session} >&2
                exit 1
              }
            done

            # The user units must be installed: the launcher starts
            # `domicile-session.target`, which binds
            # `graphical-session.target`, which the portal requires.
            [ ${pkgs.lib.boolToString (pkgs.lib.elem domicilePackage machine.config.systemd.packages)} = true ] || {
              echo "the module does not install domicile's user units" >&2
              exit 1
            }
            target=${domicilePackage}/lib/systemd/user/domicile-session.target
            for line in 'BindsTo=graphical-session.target' 'Before=graphical-session.target'; do
              grep -qxF "$line" "$target" || {
                echo "domicile-session.target is missing: $line" >&2
                cat "$target" >&2
                exit 1
              }
            done
            # The shutdown target stops the graphical session even while the
            # portal runs.
            shutdown=${domicilePackage}/lib/systemd/user/domicile-session-shutdown.target
            grep -qxF 'Conflicts=graphical-session.target graphical-session-pre.target' "$shutdown" || {
              echo "domicile-session-shutdown.target does not conflict the session down" >&2
              cat "$shutdown" >&2
              exit 1
            }

            # Domicile must be on the system profile so the portal, which runs
            # outside the desktop, finds its default-browser file.
            [ ${pkgs.lib.boolToString (pkgs.lib.elem domicilePackage machine.config.environment.systemPackages)} = true ] || {
              echo "the module does not put domicile on the system profile" >&2
              exit 1
            }

            # The PAM service `lock.pam_service` names. Home-manager cannot
            # declare it, and a desktop configured to lock fails to start
            # without it.
            [ ${pkgs.lib.boolToString (machine.config.security.pam.services ? domicile)} = true ] || {
              echo "the module declared no domicile PAM service" >&2
              exit 1
            }

            # UPower, which `@domicile-desktop/system-battery` reads. NixOS
            # enables it only with a desktop that asks for it.
            [ ${pkgs.lib.boolToString machine.config.services.upower.enable} = true ] || {
              echo "the module does not enable UPower, so the shell has no battery" >&2
              exit 1
            }

            # The `domicile` group's sessions may raise threads to the
            # priorities the engine asks for its frame and audio threads.
            [ ${pkgs.lib.boolToString (machine.config.users.groups ? domicile)} = true ] || {
              echo "the module declares no domicile group" >&2
              exit 1
            }
            for limit in ${pkgs.lib.escapeShellArgs (map (each: "${each.domain} ${each.type} ${each.item} ${toString each.value}") machine.config.security.pam.loginLimits)}; do
              echo "$limit"
            done >limits
            for expected in '@domicile - nice -10' '@domicile - rtprio 8'; do
              grep -qxF "$expected" limits || {
                echo "the module's login limits are missing: $expected" >&2
                cat limits >&2
                exit 1
              }
            done

            # `domicile-portals.conf` routes every portal call to Domicile but
            # `Secret`, which goes to the keyring.
            found=
            for package in ${toString machine.config.xdg.portal.configPackages}; do
              conf="$package/share/xdg-desktop-portal/domicile-portals.conf"
              if [ -e "$conf" ]; then
                found="$conf"
              fi
            done
            [ -n "$found" ] || {
              echo "no configPackage holds a domicile-portals.conf" >&2
              exit 1
            }
            routes=$(grep -vE '^(#|$)' "$found")
            [ "$routes" = "$(printf '%s\n' \
              '[preferred]' \
              'default=domicile' \
              'org.freedesktop.impl.portal.Secret=gnome-keyring')" ] || {
              echo "domicile-portals.conf routes other than domicile and the keyring:" >&2
              cat "$found" >&2
              exit 1
            }
            # No gtk backend is offered.
            [ ${pkgs.lib.boolToString (pkgs.lib.elem pkgs.xdg-desktop-portal-gtk machine.config.xdg.portal.extraPortals)} = false ] || {
              echo "the module still offers xdg-desktop-portal-gtk" >&2
              exit 1
            }

            touch "$out"
          '';
      };

      apps.${system} = {
        # `nix run github:cprussin/domicile` runs `domicile`, which takes the
        # shell to run. Use `#manganese` or `#simple` for a bundled desktop.
        default = {
          type = "app";
          program = pkgs.lib.getExe domicilePackage;
          meta.description = domicilePackage.meta.description;
        };
        inherit (domicileApps) manganese simple;
        # No `engine` app: running it would only start bare Chromium. Use
        # `nix build .#engine`.
      };

      devShells.${system} = {
        # Default shell: tools for the pure-logic crates and TypeScript.
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

        # Full shell: adds the libraries domicile-compositor needs.
        full = pkgs.mkShell {
          packages = coreTools ++ hostLibs;
          RUST_BACKTRACE = "1";
          FORCE_COLOR = 1;
          BIOME_BINARY = pkgs.lib.getExe pkgs.biome;
          # The EDID vendor table the installed wrapper sets, so `cargo run`
          # names monitor makers the same way.
          DOMICILE_PNP_IDS = "${pkgs.hwdata}/share/hwdata/pnp.ids";
          # `dlopen`ed libraries are not on the loader path from `packages`
          # alone. `/run/opengl-driver/lib` comes first so NixOS uses the EGL
          # matching its kernel driver.
          LD_LIBRARY_PATH =
            "/run/opengl-driver/lib:${pkgs.lib.makeLibraryPath [
              pkgs.libGL
              pkgs.mesa
              pkgs.libgbm
              # winit probes both Wayland and X11 client libraries. Without
              # them it reports `NoWaylandLib` and opens no window.
              pkgs.wayland
              pkgs.libxkbcommon
              pkgs.libx11
              pkgs.libxcursor
              pkgs.libxrandr
              pkgs.libxi
              # libpam for the lock screen, so tests use the same PAM as the
              # package instead of the host's.
              pkgs.pam
            ]}:${pkgs.lib.makeLibraryPath engineRuntimeLibs}";
          shellHook = ''
            echo "domicile dev shell (full: +wayland +drm +gl)"
          '';
        };
      };
    };
}
