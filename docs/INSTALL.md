# Install

Domicile runs on Linux. One package has all of it:

- `domicile`, which runs a shell, in a window or on the whole screen
- the **Domicile** login session
- manganese, the reference shell
- React and the `@domicile-desktop/*` packages a shell builds against

Install it from your distribution's package manager, or with Nix.

Domicile runs Wayland apps. There is no Xwayland, so apps that only speak X11
don't run ([Your apps](use/FIRST-STEPS.md#your-apps)).

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

Add the flake to your system and home configurations. A complete flake that
does it: [`examples/nixos`](/examples/nixos).

```nix
# configuration.nix
{
  imports = [domicile.nixosModules.default];
  programs.domicile.enable = true;
  services.displayManager.defaultSession = "domicile";
}
```

```nix
# home.nix
{
  imports = [domicile.homeManagerModules.default];
  programs.domicile = {
    enable = true;
    # manganese, or your own shell's built module.
    shell = "${domicile.packages.${system}.manganese}/shell.js";
  };
}
```

The system module adds the login session, the password check for the lock
screen, battery and casting support. The home module writes your
[config file](SHELL-CONFIG.md#home-manager).

<!-- /tabs -->

Your package manager keeps Domicile up to date. The repositories hold the
three newest releases. This is the same install as manganese's
([Install manganese](use/INSTALL.md)).

## After installing

On every distribution but NixOS:

1. Name the shell the login session runs in `~/.config/domicile/domicile.json`:
   manganese, as here, or your own
   ([The config file](SHELL-CONFIG.md#where-it-is)).

   ```json
   { "shell": "@domicile-desktop/manganese" }
   ```

2. Log out, and pick **Domicile** in your login screen.

You don't need the login session to write a shell: `domicile ./shell.tsx`
runs one in a window on your current desktop. Start with the
[Shell quickstart](SHELL-QUICKSTART.md).

## Try it first

With [Nix](https://nixos.org/download), run manganese in a window on your
current desktop, with nothing installed:

```sh
nix run github:cprussin/domicile/stable#manganese
```

`nix run` installs nothing on the system, so the password check the lock
screen uses (`/etc/pam.d/domicile`) is missing. In a trial, don't lock the
screen or let the machine sleep, which locks it too: nothing would unlock it.
If it locks anyway, close the window. From a console login, switch to another
console (Ctrl+Alt+F3), log in and run `pkill -f domicile`. To lock for real,
install a package or add the file ([LOCK.md](LOCK.md#verifiers)).

## The newest build

Packages of the newest `stable` build, before it is released, and Nix on
another distribution: [Install manganese](use/INSTALL.md#the-newest-build) and
[RUNNING-A-DESKTOP.md](RUNNING-A-DESKTOP.md).
