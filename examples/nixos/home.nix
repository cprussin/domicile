{ domicile, pkgs, ... }:
{
  imports = [ domicile.homeManagerModules.default ];

  programs.domicile = {
    enable = true;
    shell = "${domicile.packages.${pkgs.stdenv.hostPlatform.system}.manganese}/shell.js";
  };

  home.stateVersion = "25.11";
}
