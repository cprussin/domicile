{ domicile, ... }:
{
  imports = [ domicile.nixosModules.default ];

  programs.domicile.enable = true;
  services.displayManager.defaultSession = "domicile";
  services.displayManager.gdm.enable = true;

  users.users.you = {
    isNormalUser = true;
    extraGroups = [ "domicile" ];
  };

  system.stateVersion = "25.11";
}
