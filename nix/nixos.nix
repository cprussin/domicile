# Domicile as a NixOS module: the half of a desk that is the machine's.
#
# `nix/home-manager.nix` describes the desk itself -- the config file, the
# shell, the keys -- and declines the rest, because how a machine boots and
# which PAM services it has are not a home directory's to decide. This is that
# rest: the `domicile` login session and the user unit it starts, the PAM
# service a desk's lock opens through, and where the desk's portal calls are
# routed.
#
# ONE SESSION, WHATEVER THE DESK. `domicile` runs the shell its config names,
# so which desktop a machine boots into is the config's to say, not the login
# screen's.
#
# IT CHOOSES NO DEFAULT SESSION AND ENABLES NO DISPLAY MANAGER. Offering the
# session is this module's; booting into it is
# `services.displayManager.defaultSession = "domicile"` in the machine's own
# configuration.
#
# CURRIED, for the reason the home-manager module is: `domicilePackages` is
# this flake's own, for the defaults.
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

    # `domicile-session.target`, which a desk that is the session starts so
    # that `graphical-session.target` -- and with it the portal -- can.
    systemd.packages = [cfg.package];

    # On the system profile too, for the portal: it runs outside the desk and
    # finds `domicile-mimeapps.list` only here. Read only where
    # `XDG_CURRENT_DESKTOP` is `domicile`, which only a desk that is the
    # session says to the user manager.
    environment.systemPackages = [cfg.package];

    # What `lock.pam_service = "domicile"` names. A desk that names a service
    # the machine does not have does not come up.
    security.pam.services.domicile = {};

    # Inert unless the machine turns `xdg.portal` on; then Domicile answers
    # `Settings` and its `domicile-portals.conf` routes the rest to gtk, which
    # comes with it so that conf names a backend that is there.
    xdg.portal = {
      extraPortals = [cfg.package pkgs.xdg-desktop-portal-gtk];
      configPackages = [cfg.package];
    };
  };
}
