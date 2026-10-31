{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    domicile.url = "github:cprussin/domicile/stable";
  };

  outputs = { nixpkgs, home-manager, domicile, ... }: {
    nixosConfigurations.my-machine = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      # Hands `domicile` to configuration.nix.
      specialArgs = { inherit domicile; };
      modules = [
        # Written by nixos-generate-config.
        ./hardware-configuration.nix
        ./configuration.nix
        home-manager.nixosModules.home-manager
        {
          # Hands `domicile` to home.nix.
          home-manager.extraSpecialArgs = { inherit domicile; };
          home-manager.users.you = import ./home.nix;
        }
      ];
    };
  };
}
