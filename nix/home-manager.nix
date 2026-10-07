# Home-manager module for Domicile.
#
# Writes `~/.config/domicile/domicile.json` and installs a `domicile` that runs
# the configured shell by default. `settings` mirrors the `domicile-config`
# crate's schema; `scripts/test-the-home-manager-module-agrees.sh` checks that
# they match. `settings` is freeform so a newer domicile works with an older
# module.
#
# The login session belongs to the NixOS module (`nix/nixos.nix`).
#
# Curried so `domicilePackages` can supply this flake's package defaults.
{domicilePackages}: {
  lib,
  pkgs,
  config,
  ...
}: let
  cfg = config.programs.domicile;

  json = pkgs.formats.json {};

  # A two-element list, as the config file takes it: `"size": [1920, 1080]`.
  pairOf = element: lib.types.addCheck (lib.types.listOf element) (xs: lib.length xs == 2);

  pair = element: description:
    lib.mkOption {
      inherit description;
      type = pairOf element;
    };

  # Drops nulls recursively, through attrsets and lists.
  #
  # `domicile` reads an absent key as a setting (no `idle.blank_after_seconds`
  # means never blank) and rejects `null` for most keys. Recurses into lists
  # because `output.profiles` contains nullable options.
  withoutNulls = value:
    if lib.isAttrs value
    then lib.mapAttrs (_: withoutNulls) (lib.filterAttrs (_: each: each != null) value)
    else if lib.isList value
    then map withoutNulls value
    else value;

  # One of the `lockdown` switches, which applications read through the
  # Lockdown portal.
  lockdownSwitch = description:
    lib.mkOption {
      inherit description;
      type = lib.types.bool;
      default = false;
    };

  # `wl_output` rotations, counterclockwise as in kanshi and sway: `rotate-270`
  # suits a panel standing on its left side. The strings match the config
  # file, not the Rust variant names.
  transform = lib.types.enum ["normal" "rotate-90" "rotate-180" "rotate-270"];

  # A display for a nested run, which has no hardware to report its size.
  display = lib.types.submodule {
    options = {
      name = lib.mkOption {
        description = "The display's name, shared by the chrome and the compositor. Matched exactly.";
        type = lib.types.str;
      };
      position =
        (pair lib.types.int "The top-left corner, in the config's coordinate space. May be negative.")
        // {default = [0 0];};
      size = pair lib.types.ints.positive "Width and height in logical units. The `wl_output` mode is this times `scale`.";
      scale = lib.mkOption {
        description = "The `wl_output` scale advertised to clients on this display.";
        type = lib.types.ints.positive;
        default = 1;
      };
    };
  };

  # One monitor's placement in a profile. The monitor reports its own mode, so
  # there is no size.
  placement = lib.types.submodule {
    options = {
      display = lib.mkOption {
        description = ''
          The monitor to place. Matches the output name (`drm-<id>`), the EDID's
          `"<MAKE> <MODEL> <SERIAL>"` (`DEL DELL U3219Q 2ZLS413`), or the same
          with the maker's name from hwdata's `pnp.ids` (`Dell Inc. DELL U3219Q
          2ZLS413`), as kanshi and sway use.
        '';
        type = lib.types.str;
      };
      enabled = lib.mkOption {
        description = "Whether to turn this monitor on. A profile must still list the monitors it turns off.";
        type = lib.types.bool;
        default = true;
      };
      mode = lib.mkOption {
        description = ''
          The mode this entry expects, in physical pixels. Domicile does not set
          modes: the engine lights each connector at its native mode. If the
          monitor comes up at a different mode, the running desktop is left as
          is and the mismatch is reported. Size only; the refresh rate cannot be
          chosen. `null` accepts any mode.
        '';
        type = lib.types.nullOr (pairOf lib.types.ints.positive);
        default = null;
      };
      position =
        (pair lib.types.int "The top-left corner, in the desktop's logical units.")
        // {default = [0 0];};
      scale = lib.mkOption {
        description = ''
          Device pixels per logical pixel. May be fractional: 1.5 on a 2880x1920
          panel gives a 1920x1280 desktop.
        '';
        type = lib.types.numbers.positive;
        default = 1.0;
      };
      transform = lib.mkOption {
        description = "The monitor's rotation.";
        type = transform;
        default = "normal";
      };
    };
  };

  # A monitor arrangement, chosen by which monitors are connected. The first
  # profile whose exact set is connected wins, rechecked on every hotplug.
  profile = lib.types.submodule {
    options = {
      name = lib.mkOption {
        description = "The profile's name, used in logs. Must be unique.";
        type = lib.types.str;
      };
      displays = lib.mkOption {
        description = "The monitors this profile places. It applies only when exactly this set is connected.";
        type = lib.types.listOf placement;
      };
    };
  };

  # Runs `domicile`, appending the configured shell unless the command line
  # already names what to run:
  #
  #   domicile                       -- runs the configured shell
  #   domicile which-shell           -- passed through
  #   domicile load-shell ./other.js -- passed through
  #   domicile ./other.js            -- the typed shell wins
  #
  # The scan skips the argument after `--config`.
  launcher = pkgs.writeShellScript "domicile" ''
    for word in "$@"; do
      if [ -n "''${skip-}" ]; then
        skip=
        continue
      fi
      case "$word" in
        --config) skip=1 ;;
        *) named_one=1 ;;
      esac
    done

    # A verb is only a verb as the first word, and a line that starts with one
    # has said what it wants whatever follows -- `load-shell` takes a shell of
    # its own and `open-url` an address, neither of which is the configured
    # shell being asked for.
    case "''${1-}" in
      which-shell|load-shell|open-url) named_one=1 ;;
    esac

    if [ -n "''${named_one-}" ]; then
      exec ${cfg.package}/bin/domicile "$@"
    fi
    exec ${cfg.package}/bin/domicile "$@" ${lib.escapeShellArg (toString cfg.shell)}
  '';

in {
  imports = [
    (lib.mkRemovedOptionModule ["programs" "domicile" "defaultBrowser"] ''
      Domicile ships its own `domicile-mimeapps.list` and puts it in front of
      every app's data directories, so the home needs no file: inside a desk
      web links open there unless a `mimeapps.list` of your own names a
      browser.
    '')
  ];

  options.programs.domicile = {
    enable = lib.mkEnableOption "Domicile, a Wayland compositor whose renderer is a web engine";

    package = lib.mkOption {
      description = ''
        The package providing `domicile`, `domicile-compositor` and the
        engine beside them.
      '';
      type = lib.types.package;
      default = domicilePackages.domicile;
      defaultText = lib.literalExpression "domicile.packages.\${system}.domicile";
    };

    shell = lib.mkOption {
      description = ''
        The built JavaScript module for your desktop, baked into the `domicile`
        on PATH.

        Must be the module file, not its directory; `domicile` refuses a
        directory.

        `null` leaves `domicile` taking the shell as an argument, for switching
        between desktops.
      '';
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = lib.literalExpression "\"\${domicile.packages.\${system}.manganese}/shell.js\"";
    };

    settings = lib.mkOption {
      description = ''
        The compositor configuration, written to
        `''${config.xdg.configHome}/domicile/domicile.json`, the default
        `--config` path.

        `domicile` re-reads it while running, so a rebuild applies to a running
        desk without closing windows. Options read only at startup say so.

        This mirrors the `domicile-config` schema. It is freeform: unknown keys
        are written through.
      '';
      default = {};
      type = lib.types.submodule {
        freeformType = json.type;
        options = {
          extensions = {
            web_store = lib.mkOption {
              description = ''
                Chrome Web Store IDs of extensions to install and keep updated.
                Listing one installs it without a prompt; removing it uninstalls
                it. Manifest V3 only.
              '';
              type = lib.types.listOf lib.types.str;
              default = [];
              example = ["ddkjiahejlhfcafbddmgiahcphecmpfh"];
            };
            unpacked = lib.mkOption {
              description = ''
                Directories of unpacked extensions to load. Absolute, or
                starting with `~` (`~` or `~/...`), expanded to the desk's home.
                `~user` is refused.
              '';
              type = lib.types.listOf lib.types.str;
              default = [];
              example = ["~/src/my-extension"];
            };
          };

          files.omit = lib.mkOption {
            description = ''
              Paths the launcher's file index skips, as gitignore-style globs
              relative to the home: `*` stops at `/`, `**` does not, a leading
              `!` re-includes, and the last matching pattern wins. Skipped
              directories are not walked, so nothing under them can be
              re-included.

              The default skips hidden files at any depth. Setting a list
              replaces it.

              Applied on reload; the home is re-indexed.
            '';
            type = lib.types.listOf lib.types.str;
            default = ["**/.*"];
            example = ["*/*" "!Scratch/*"];
          };

          idle = {
            blank_after_seconds = lib.mkOption {
              description = ''
                Seconds without input before the screens blank. Any key, click,
                scroll or pointer movement wakes them.

                `null`, the default, never blanks. The shell gets no warning
                before blanking, so this is opt-in.

                Blanking also locks a desk that sets a `lock` verifier. Without
                a timeout, the desk locks only when its shell asks.

                Applied on reload, including adding or removing the timeout.
                Blanked screens turn back on when this changes.
              '';
              type = lib.types.nullOr lib.types.ints.positive;
              default = null;
              example = 600;
            };
          };

          lock = {
            pam_service = lib.mkOption {
              description = ''
                The PAM service that unlocks the desk with the user's password.

                Home-manager cannot declare a PAM service. The flake's NixOS
                module declares one, or declare it yourself:

                    security.pam.services.domicile = {};

                and set this to `"domicile"`. If the service is missing, the
                desk fails to start and says what to declare, instead of falling
                back to PAM's `other` service.

                With this and `passphrase` both `null` (the default), the desk
                never locks, since nothing could unlock it. Setting both is
                refused.

                The compositor delivers no input to clients while locked, so the
                lock holds across a shell reload or an engine restart.

                The desk locks when `idle.blank_after_seconds` elapses or when
                its shell asks. Read at startup only, so editing the file cannot
                unlock a locked desk; changes apply on the next run.
              '';
              type = lib.types.nullOr lib.types.str;
              default = null;
              example = "domicile";
            };

            passphrase = lib.mkOption {
              description = ''
                A passphrase that unlocks the desk, for machines without a PAM
                service. Prefer `pam_service`.

                This is not secret: the file is in the world-readable Nix store,
                so any user on the machine can read it. It only stops someone at
                the keyboard.

                `pam_service`'s notes on locking apply here too, including that
                only one of the two may be set.
              '';
              type = lib.types.nullOr lib.types.str;
              default = null;
              example = "open sesame";
            };
          };

          # Applications enforce these themselves; the compositor reports them
          # through the Lockdown portal. Applied on reload.
          lockdown = {
            disable_printing = lockdownSwitch "Asks applications not to print.";
            disable_save_to_disk = lockdownSwitch "Asks applications not to save files.";
            disable_application_handlers = lockdownSwitch "Asks applications not to open files or links in other applications.";
            disable_location = lockdownSwitch "Asks applications not to read the location.";
            disable_camera = lockdownSwitch "Asks applications not to use cameras.";
            disable_microphone = lockdownSwitch "Asks applications not to use microphones.";
            disable_sound_output = lockdownSwitch "Asks applications not to play sound.";
          };

          startup.commands = lib.mkOption {
            description = ''
              Commands the desk runs once at startup, each an argv with no
              shell. They run on the desk's display. A reload does not rerun
              them.
            '';
            type = lib.types.listOf (lib.types.nonEmptyListOf lib.types.str);
            default = [];
            example = [["emacsclient" "-e" "t"]];
          };

          theme.mode = lib.mkOption {
            description = ''
              Whether the desktop is drawn dark or light.

              There is no `"system"` value, because Domicile is the system and
              has no preference to follow. `"system"` is refused.

              The shell draws with it, and the compositor passes it to the
              settings portal, which GTK, Qt, Electron and Firefox windows read.

              This is the startup theme. The shell's toggle changes the live
              theme without writing this file, since the file is generated. A
              rebuild that changes this value overrides the toggle.
            '';
            type = lib.types.enum ["dark" "light"];
            default = "dark";
            example = "light";
          };

          theme.accent_color = lib.mkOption {
            description = ''
              The color applications highlight with, as `"#rrggbb"`, through
              the settings portal. `null`, the default, leaves each
              application its own.
            '';
            type = lib.types.nullOr (lib.types.strMatching "#[0-9a-fA-F]{6}");
            default = null;
            example = "#3584e4";
          };

          theme.contrast = lib.mkOption {
            description = "Whether applications draw with high contrast, through the settings portal.";
            type = lib.types.enum ["normal" "high"];
            default = "normal";
          };

          theme.reduced_motion = lib.mkOption {
            description = "Whether applications keep animation to a minimum, through the settings portal.";
            type = lib.types.bool;
            default = false;
          };

          input.keyboard = {
            xkb_rules = lib.mkOption {
              description = "Passed to xkb as is. Empty uses the libxkbcommon default.";
              type = lib.types.str;
              default = "";
            };
            xkb_model = lib.mkOption {
              description = "Passed to xkb as is. Empty uses the libxkbcommon default.";
              type = lib.types.str;
              default = "";
            };
            xkb_layout = lib.mkOption {
              description = ''
                The layout, in sway's format, including comma-separated multiple
                layouts (`"us,de"`).
              '';
              type = lib.types.str;
              default = "us";
            };
            xkb_variant = lib.mkOption {
              description = "The variant, e.g. `dvp`. Empty uses the layout's default.";
              type = lib.types.str;
              default = "";
            };
            xkb_options = lib.mkOption {
              description = ''
                xkb options, as a list instead of sway's comma-separated string.
              '';
              type = lib.types.listOf lib.types.str;
              default = [];
              example = ["caps:escape"];
            };
          };

          output = {
            displays = lib.mkOption {
              description = ''
                Explicit displays for a nested run, which has no monitors to
                enumerate. Empty gives a single output that follows Domicile's
                window.
              '';
              type = lib.types.listOf display;
              default = [];
            };
            max_scale = lib.mkOption {
              description = ''
                The highest `wl_output` scale to advertise. Limits cost: a
                client at scale N draws N² times the pixels. `1` disables
                scaling.

                Applies only to the output that follows Domicile's window; a
                listed display sets its own scale.

                Applied on reload.
              '';
              type = lib.types.ints.positive;
              default = 2;
            };
            profiles = lib.mkOption {
              description = ''
                Monitor arrangements, as in kanshi: the first profile whose
                exact set is connected wins, rechecked on every hotplug.
              '';
              type = lib.types.listOf profile;
              default = [];
            };
          };
        };
      };
    };

    finalPackage = lib.mkOption {
      description = "The installed package: `package`, wrapped if `shell` is set.";
      type = lib.types.package;
      readOnly = true;
      visible = false;
    };
  };

  config = lib.mkIf cfg.enable {
    # Also set the config's `shell`, so a `domicile` started without the
    # wrapper (such as the NixOS login session) runs the same one. A default,
    # so an explicit `settings.shell` wins.
    programs.domicile.settings.shell =
      lib.mkIf (cfg.shell != null) (lib.mkDefault (toString cfg.shell));

    # Wrap only when there is a shell to add.
    programs.domicile.finalPackage =
      if cfg.shell == null
      then cfg.package
      else
        pkgs.symlinkJoin {
          name = "domicile-with-a-shell";
          paths = [cfg.package];
          # A script instead of `wrapProgram --add-flags`: `domicile` reads a
          # verb only as the first argument, so prepending the shell path
          # would break `domicile which-shell`. The script appends the shell,
          # and only when the command line names none.
          postBuild = ''
            rm "$out/bin/domicile"
            ln -s ${launcher} "$out/bin/domicile"
          '';
          inherit (cfg.package) meta;
        };

    home.packages = [cfg.finalPackage];

    # Takes effect only when `xdg.portal.enable` is set. gtk is included
    # because `domicile-portals.conf` routes unhandled interfaces to it.
    xdg.portal = {
      extraPortals = [cfg.finalPackage pkgs.xdg-desktop-portal-gtk];
      configPackages = [cfg.finalPackage];
    };

    # `domicile` reads this path when no `--config` is given. Nulls are
    # dropped; see `withoutNulls`.
    xdg.configFile."domicile/domicile.json".source =
      json.generate "domicile.json" (withoutNulls cfg.settings);
  };
}
