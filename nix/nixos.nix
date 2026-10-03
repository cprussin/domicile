# Domicile as a NixOS module: the half of a desk that is the machine's.
#
# `nix/home-manager.nix` describes the desk itself -- the config file, the
# shell, the keys -- and declines the rest, because how a machine boots and
# which PAM services it has are not a home directory's to decide. This is that
# rest: each desktop as a login session, the PAM service a desk's lock opens
# through, and where the desk's portal calls are routed.
#
# IT CHOOSES NO DEFAULT SESSION AND ENABLES NO DISPLAY MANAGER. Offering a
# desktop at the login screen is this module's; booting into one is
# `services.displayManager.defaultSession = "manganese"` in the machine's own
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
  options.programs.domicile = {
    enable = lib.mkEnableOption "Domicile's desktops as login sessions, and the PAM service a desk's lock opens through";

    package = lib.mkOption {
      description = ''
        The package providing Domicile's portal backend and its routing.
      '';
      type = lib.types.package;
      default = domicilePackages.domicile;
      defaultText = lib.literalExpression "domicile.packages.\${system}.domicile";
    };

    desktops = lib.mkOption {
      description = ''
        The desktops a display manager offers, each a session named after
        itself: `manganese` runs `manganese`. A desktop is the shell plus
        Domicile, so it reads the same `~/.config/domicile/domicile.toml` the
        home-manager module writes.
      '';
      type = lib.types.listOf lib.types.package;
      default = [domicilePackages.manganese];
      defaultText = lib.literalExpression "[ domicile.packages.\${system}.manganese ]";
    };
  };

  config = lib.mkIf cfg.enable {
    services.displayManager.sessionPackages = cfg.desktops;

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
