# NixOS module for the machine-level parts of a Domicile desk.
#
# `nix/home-manager.nix` configures the desk itself. This module provides the
# `domicile` login session and its user units, the PAM service the lock uses,
# UPower for the battery, portal routing, and the `domicile` group whose
# sessions may raise the engine's frame threads. See
# docs/RUNNING-A-DESKTOP.md#on-nixos.
#
# The session runs whichever shell the config names. The module sets no
# default session and enables no display manager; set
# `services.displayManager.defaultSession = "domicile"` for that.
#
# Curried so `domicilePackages` can supply this flake's package defaults.
{domicilePackages}: {
  lib,
  pkgs,
  config,
  ...
}: let
  cfg = config.programs.domicile;
in {
  imports = [
    (lib.mkRemovedOptionModule ["programs" "domicile" "desktops"] ''
      There is one session, `domicile`, which runs the shell the config names:
      set `"shell"` in ~/.config/domicile/domicile.json (`programs.domicile.shell`
      in the home-manager module) instead.
    '')
  ];

  options.programs.domicile = {
    enable = lib.mkEnableOption "the `domicile` login session, and the PAM service a desk's lock opens through";

    package = lib.mkOption {
      description = ''
        The package providing the `domicile` session, Domicile's portal
        backend and its routing.
      '';
      type = lib.types.package;
      default = domicilePackages.domicile;
      defaultText = lib.literalExpression "domicile.packages.\${system}.domicile";
    };
  };

  config = lib.mkIf cfg.enable {
    services.displayManager.sessionPackages = [cfg.package];

    # Installs `domicile-session.target`, which starts
    # `graphical-session.target` and so the portal.
    systemd.packages = [cfg.package];

    # The portal runs outside the desk and finds `domicile-mimeapps.list` only
    # on the system profile. It is read only when `XDG_CURRENT_DESKTOP` is
    # `domicile`.
    environment.systemPackages = [cfg.package];

    # Read by `@domicile-desktop/system-battery`, so manganese's bar and lock
    # screen show the battery. NixOS enables it only for desktops that ask.
    services.upower.enable = lib.mkDefault true;

    # Named by `lock.pam_service = "domicile"`. A desk whose PAM service is
    # missing fails to start.
    security.pam.services.domicile = {};

    # The engine asks for nice -8 on the threads that draw and present frames
    # and SCHED_RR 8 on its realtime audio threads, falling back to nice -10.
    # Without these limits each request fails and the threads compete with a
    # build at nice 0. Granted to a group, as NixOS's PipeWire and JACK modules
    # do. Listed first (`mkBefore`) because a later pam_limits line for another
    # group overrides an earlier one, so a larger grant such as PipeWire's wins.
    users.groups.domicile = {};
    security.pam.loginLimits = lib.mkBefore [
      {
        domain = "@domicile";
        type = "-";
        item = "nice";
        value = -10;
      }
      {
        domain = "@domicile";
        type = "-";
        item = "rtprio";
        value = 8;
      }
    ];

    # Takes effect only when `xdg.portal.enable` is set. Domicile is the only
    # backend; `domicile-portals.conf` sends `Secret` to the keyring, which
    # the user installs.
    xdg.portal = {
      extraPortals = [cfg.package];
      configPackages = [cfg.package];
    };
  };
}
