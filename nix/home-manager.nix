# Domicile as a home-manager module.
#
# Writes `~/.config/domicile/domicile.toml` -- which is where `domicile`
# looks when nothing passes it a `--config` -- and puts a `domicile` on PATH
# that already knows which shell to run.
#
# TWO HALVES, AND ONLY ONE OF THEM IS THIS MODULE'S IDEA. The file's schema
# belongs to the `domicile-config` crate; everything under `settings` is that
# schema spelled in Nix, and `scripts/test-the-home-manager-module-agrees.sh`
# compares the two without building anything. What this module decides is the
# rest: where the file goes, which package provides `domicile`, and that a
# shell named here is baked into the command rather than typed every time.
#
# `settings` HAS A FREEFORM TYPE for that reason. A key this module has not
# caught up with is passed through rather than refused, so a newer domicile is
# usable from an older module -- and the declared options below are there for
# the documentation, the type checking and the defaults, not as a gate.
#
# NO SESSION, NO UNIT. Making domicile a login session is a NixOS-level
# decision about how a machine boots, and a home-manager module is the wrong
# place to make it.
#
# CURRIED, because half of what this needs is fixed when the flake exposes it
# and half arrives from the configuration importing it: `domicilePackages` is
# this flake's own, for the default `package`, and the rest is the ordinary
# module argument set.
{domicilePackages}: {
  lib,
  pkgs,
  config,
  ...
}: let
  cfg = config.programs.domicile;

  toml = pkgs.formats.toml {};

  # A width and a height, or an x and a y. Two-element lists because that is
  # what the config file takes: `size = [1920, 1080]`.
  pair = element: description:
    lib.mkOption {
      inherit description;
      type = lib.types.addCheck (lib.types.listOf element) (xs: lib.length xs == 2);
    };

  # The four `wl_output` rotations, named for the turn the CONTENT takes to
  # come out upright -- `rotate-90` is a quarter turn clockwise, for a panel
  # bolted a quarter turn anticlockwise. Spelled the way the file spells them,
  # which is not serde's kebab-case of the Rust variant.
  transform = lib.types.enum ["normal" "rotate-90" "rotate-180" "rotate-270"];

  # One monitor of a desktop stated outright, which is the nested case: no
  # hardware is consulted, so a display states its own size.
  display = lib.types.submodule {
    options = {
      name = lib.mkOption {
        description = "How the chrome and the compositor name this display to each other. Matched exactly.";
        type = lib.types.str;
      };
      position =
        (pair lib.types.int "The top-left corner, in the config's own coordinate space. Negative is fine.")
        // {default = [0 0];};
      size = pair lib.types.ints.positive "Width and height in logical units. A `wl_output` mode is this times `scale`.";
      scale = lib.mkOption {
        description = "The `wl_output` scale advertised to clients on this display.";
        type = lib.types.ints.positive;
        default = 1;
      };
    };
  };

  # Where one monitor of a profile goes. The monitor states its own mode, so
  # this states a placement and not a size.
  placement = lib.types.submodule {
    options = {
      display = lib.mkOption {
        description = ''
          Which monitor this places: either the output's name (`drm-<id>`) or
          the panel's own `"<MAKE> <MODEL> <SERIAL>"` off its EDID, which is
          the string kanshi and sway match on.
        '';
        type = lib.types.str;
      };
      enabled = lib.mkOption {
        description = "Whether to light this monitor at all. A profile still has to name one it turns off.";
        type = lib.types.bool;
        default = true;
      };
      position =
        (pair lib.types.int "The top-left corner, in the desktop's logical units.")
        // {default = [0 0];};
      scale = lib.mkOption {
        description = ''
          Device pixels per logical pixel: the mode the connector scans out
          over the size the desktop is laid out at. Fractional, because the
          scales a desk is used at are -- 1.5 on a 2880x1920 panel is the
          1920x1280 desktop it is readable at.
        '';
        type = lib.types.numbers.positive;
        default = 1.0;
      };
      transform = lib.mkOption {
        description = "Which way up the monitor is.";
        type = transform;
        default = "normal";
      };
    };
  };

  # One arrangement, chosen by which monitors are plugged in. The first
  # profile whose exact set is connected wins, and it is re-matched on every
  # hotplug.
  profile = lib.types.submodule {
    options = {
      name = lib.mkOption {
        description = "What this arrangement is called. Unique, and for the log rather than for matching.";
        type = lib.types.str;
      };
      displays = lib.mkOption {
        description = "Every monitor this profile is for. A profile applies only to the exact set it names.";
        type = lib.types.listOf placement;
      };
    };
  };

  # `domicile` with the configured shell supplied when the command line has not
  # already said what to run. Three invocations have to keep working and only
  # one of them wants a shell added:
  #
  #   domicile              -- the configured shell, which is the whole point
  #   domicile which-shell  -- the verb, handed over untouched
  #   domicile ./other.js   -- what was typed beats what was configured
  #
  # `--config PATH` is the one flag that eats the word after it, so the scan
  # steps over that word rather than reading a path as a shell.
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

    # A verb is only a verb as the first word and it takes nothing else, so
    # this counts as the line having said what it wants.
    case "''${1-}" in
      which-shell) named_one=1 ;;
    esac

    if [ -n "''${named_one-}" ]; then
      exec ${cfg.package}/bin/domicile "$@"
    fi
    exec ${cfg.package}/bin/domicile "$@" ${lib.escapeShellArg (toString cfg.shell)}
  '';

in {
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
        The built JavaScript module your desktop is, baked into the `domicile`
        on PATH so it does not have to be typed.

        THE MODULE, NOT THE DIRECTORY HOLDING IT. `domicile` refuses a
        directory and says so, because naming one meant guessing which file
        inside it was the shell.

        `null` leaves `domicile` taking the shell as an argument, which is
        what you want if you switch between desktops.
      '';
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = lib.literalExpression "\"\${domicile.packages.\${system}.manganese}/shell.js\"";
    };

    settings = lib.mkOption {
      description = ''
        The compositor's own configuration, written to
        `''${config.xdg.configHome}/domicile/domicile.toml` -- which is where
        `domicile` looks when nothing hands it a `--config`.

        Re-read while it runs, so a rebuild reaches a desk that is already up.

        This is the `domicile-config` schema in Nix, and it is freeform: a key
        this module has not caught up with is written through rather than
        refused.
      '';
      default = {};
      type = lib.types.submodule {
        freeformType = toml.type;
        options = {
          compositor.nested_size =
            (pair lib.types.ints.positive ''
              The desktop's size when nothing describes one, and the largest
              window Domicile will ask a host for once something does.
            '')
            // {default = [1280 800];};

          input.keyboard = {
            xkb_rules = lib.mkOption {
              description = "Handed to xkb verbatim. Empty means whatever libxkbcommon defaults to.";
              type = lib.types.str;
              default = "";
            };
            xkb_model = lib.mkOption {
              description = "Handed to xkb verbatim. Empty means whatever libxkbcommon defaults to.";
              type = lib.types.str;
              default = "";
            };
            xkb_layout = lib.mkOption {
              description = ''
                The layout, in sway's spelling -- so the comma-separated
                multi-layout form (`"us,de"`) works here too.
              '';
              type = lib.types.str;
              default = "us";
            };
            xkb_variant = lib.mkOption {
              description = "The variant, e.g. `dvp`. Empty is the layout's own.";
              type = lib.types.str;
              default = "";
            };
            xkb_options = lib.mkOption {
              description = ''
                A list rather than the comma-separated line sway wants,
                because the xkb format has one and this is the reader that
                can take it.
              '';
              type = lib.types.listOf lib.types.str;
              default = [];
              example = ["caps:escape"];
            };
          };

          output = {
            displays = lib.mkOption {
              description = ''
                A desktop stated outright, for a nested run with no monitors
                to enumerate. Empty is the single output that follows
                Domicile's own window.
              '';
              type = lib.types.listOf display;
              default = [];
            };
            max_scale = lib.mkOption {
              description = ''
                The highest `wl_output` scale to advertise. A cost dial rather
                than a preference: a client asked for scale N draws N² times
                the pixels. `1` turns scaling off.

                Governs only the output that follows Domicile's own window --
                a described display states its own scale.
              '';
              type = lib.types.ints.positive;
              default = 2;
            };
            profiles = lib.mkOption {
              description = ''
                Arrangements of real monitors, kanshi's model: the first
                profile whose exact set is plugged in wins, and it is matched
                again on every hotplug.
              '';
              type = lib.types.listOf profile;
              default = [];
            };
          };
        };
      };
    };

    finalPackage = lib.mkOption {
      description = "The package this module actually installs: `package`, wrapped if a `shell` was named.";
      type = lib.types.package;
      readOnly = true;
      visible = false;
    };
  };

  config = lib.mkIf cfg.enable {
    # Wrapped only when there is something to bake in, so a configuration that
    # names no shell installs the package itself rather than a wrapper around
    # it that adds nothing.
    programs.domicile.finalPackage =
      if cfg.shell == null
      then cfg.package
      else
        pkgs.symlinkJoin {
          name = "domicile-with-a-shell";
          paths = [cfg.package];
          # SUPPLIED, NOT PREPENDED, and that distinction is the whole reason
          # this is a script rather than `wrapProgram --add-flags`.
          #
          # `domicile` reads a verb only as the first word -- `which-shell` is
          # a question put to a desktop that is already running, and it takes
          # nothing else. A flag added in front makes the shell path the first
          # word, so `domicile which-shell` comes back
          # `too many arguments: which-shell` and the one command this module
          # cannot break is broken by installing it.
          #
          # So the shell goes on the end, and only when the command line has
          # not already named one.
          postBuild = ''
            rm "$out/bin/domicile"
            ln -s ${launcher} "$out/bin/domicile"
          '';
          inherit (cfg.package) meta;
        };

    home.packages = [cfg.finalPackage];

    # THE PATH IS THE INTERFACE: this is where `domicile` looks with no
    # `--config`, so it is not a location this module gets to pick.
    xdg.configFile."domicile/domicile.toml".source =
      toml.generate "domicile.toml" cfg.settings;
  };
}
