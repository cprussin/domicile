# Install

Manganese comes with Domicile, the desktop it runs on. Domicile runs on Linux.
Install it from your distribution's package manager, or with Nix, then log in
to the **Domicile** session.

<!-- tab: Debian and Ubuntu -->

Debian 13+ and Ubuntu 24.04+. On Debian 12 and Ubuntu 22.04, write `legacy`
in place of `current`.

```sh
sudo curl -fsSL -o /etc/apt/keyrings/domicile.asc https://packages.domicile-desktop.com/domicile.asc
echo "deb [signed-by=/etc/apt/keyrings/domicile.asc] https://packages.domicile-desktop.com/apt current main" |
  sudo tee /etc/apt/sources.list.d/domicile.list
sudo apt update && sudo apt install domicile
```

<!-- tab: Fedora -->

Fedora and RHEL 10+.

```sh
sudo tee /etc/yum.repos.d/domicile.repo <<'REPO'
[domicile]
name=Domicile
baseurl=https://packages.domicile-desktop.com/rpm/fedora
gpgcheck=1
repo_gpgcheck=1
gpgkey=https://packages.domicile-desktop.com/domicile.asc
REPO
sudo dnf install domicile
```

<!-- tab: openSUSE -->

openSUSE Tumbleweed.

```sh
sudo rpm --import https://packages.domicile-desktop.com/domicile.asc
sudo zypper addrepo --gpgcheck https://packages.domicile-desktop.com/rpm/opensuse domicile
sudo zypper install domicile
```

<!-- tab: Arch -->

Install `domicile-bin` from the AUR, or add the repository:

```sh
curl -fsSL -o domicile.asc https://packages.domicile-desktop.com/domicile.asc
sudo pacman-key --add domicile.asc
sudo pacman-key --lsign-key "$(gpg --show-keys --with-colons domicile.asc | awk -F: '/^fpr/ {print $10; exit}')"
printf '[domicile]\nServer = https://packages.domicile-desktop.com/arch/$arch\n' |
  sudo tee -a /etc/pacman.conf
sudo pacman -Syu domicile
```

<!-- tab: NixOS -->

Add the flake to your system and home configurations:

```nix
# configuration.nix
{
  imports = [domicile.nixosModules.default];
  programs.domicile.enable = true;
  services.displayManager.defaultSession = "domicile";
  users.users.<you>.extraGroups = ["domicile"];
}
```

```nix
# home.nix
{
  imports = [domicile.homeManagerModules.default];
  programs.domicile = {
    enable = true;
    shell = "${domicile.packages.${system}.manganese}/shell.js";
  };
}
```

The system module adds the login session, the password check for the lock
screen, battery and casting support. The home module writes your
[config file](CONFIGURE.md#home-manager).

<!-- /tabs -->

Your package manager keeps Domicile up to date. The repositories hold the
three newest releases.

## After installing

On every distribution but NixOS:

1. Join the `domicile` group, so the desktop stays smooth while the machine is
   busy: `sudo usermod -aG domicile "$USER"`.
2. Pick manganese as your desktop in `~/.config/domicile/domicile.json`:

   ```json
   { "shell": "@domicile-desktop/manganese" }
   ```

3. Log out, and pick **Domicile** in your login screen.

Then read [First steps](FIRST-STEPS.md).

## Try it first

With [Nix](https://nixos.org/download), run manganese in a window on your
current desktop, with nothing installed:

```sh
nix run github:cprussin/domicile/stable#manganese
```

From a console login, the same command takes the whole screen.

## The newest build

To run the newest `stable` build before it is released, download its package
from [`packages-latest`](https://github.com/cprussin/domicile/releases/tag/packages-latest)
and check it:

```sh
base=https://github.com/cprussin/domicile/releases/download/packages-latest
pkg=domicile_amd64.deb   # your package from the table below
curl -fL -O "$base/$pkg" -O "$base/SHA256SUMS"
sha256sum --check --ignore-missing SHA256SUMS
```

| Distribution | Install |
|---|---|
| Debian 13+, Ubuntu 24.04+ | `sudo apt install ./domicile_amd64.deb` |
| Debian 12, Ubuntu 22.04 | `sudo apt install ./domicile_amd64.noapparmor.deb` |
| Fedora, RHEL 10+ | `sudo dnf install ./domicile-fedora.x86_64.rpm` |
| openSUSE Tumbleweed | `sudo zypper install --allow-unsigned-rpm ./domicile-opensuse.x86_64.rpm` |
| Arch | `sudo pacman -U ./domicile-x86_64.pkg.tar.zst` |

Download and install it again to upgrade.

More detail, including Nix on another distribution:
[RUNNING-A-DESKTOP.md](../RUNNING-A-DESKTOP.md).
