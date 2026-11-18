# The benchmark's desktops: one NixOS VM test driver per desktop, each VM
# identical but for the desktop, plus the scripts that run them. See
# packages/benchmarks/README.md.
{ pkgs, nixpkgs, system, self }:
let
  inherit (pkgs) lib;
  unfree = import nixpkgs {
    inherit system;
    config.allowUnfreePredicate = pkg: builtins.elem (lib.getName pkg) [ "slack" ];
  };

  pages = [
    "https://en.wikipedia.org/wiki/Wayland_(protocol)"
    "https://github.com/cprussin/domicile"
    "https://news.ycombinator.com/"
  ];
  # A small TypeScript project for the editor to open.
  project = ../manganese-window-management;

  # One reading of the whole VM, as JSON: memory in use, CPU ticks, load,
  # and the proportional memory of every process and of alice's.
  sample = pkgs.writeShellApplication {
    name = "bench-sample";
    runtimeInputs = [ pkgs.coreutils pkgs.gawk ];
    text = ''
      used=$(awk '/^MemTotal:/ { t = $2 } /^MemAvailable:/ { a = $2 } END { print t - a }' /proc/meminfo)
      read -r _ user nice system idle iowait irq softirq steal _ </proc/stat
      busy=$((user + nice + system + irq + softirq + steal))
      total=$((busy + idle + iowait))
      load=$(cut -d' ' -f1 /proc/loadavg)
      # Kernel threads have no memory to read, and a process can exit
      # between the glob and the read: getline skips both, where reading
      # them as awk's input files would end awk at the first.
      read -r all mine < <(
        {
          stat -c '%n %u' /proc/[0-9]* 2>/dev/null || true
          echo ---
          awk 'BEGIN {
            for (i = 1; i < ARGC; i++) {
              while ((getline line < ARGV[i]) > 0) {
                if (line ~ /^Pss:/) { split(line, field); print ARGV[i], field[2] }
              }
              close(ARGV[i])
            }
            exit
          }' /proc/[0-9]*/smaps_rollup
        } | awk '
          $1 == "---" { pss = 1; next }
          !pss { uid[$1] = $2; next }
          { dir = $1; sub("/smaps_rollup", "", dir); all += $2; if (uid[dir] == 1000) mine += $2 }
          END { printf "%d %d\n", all, mine }'
      )
      if [ "$all" -le 0 ]; then
        echo "bench-sample: read no process's memory" >&2
        exit 1
      fi
      printf '{"busyTicks":%d,"totalTicks":%d,"usedKib":%d,"load1":%s,"pssKib":%d,"sessionPssKib":%d}\n' \
        "$busy" "$total" "$used" "$load" "$all" "$mine"
    '';
  };

  # The 25 programs holding the most proportional memory, by name, as JSON.
  top = pkgs.writeShellApplication {
    name = "bench-top";
    runtimeInputs = [ pkgs.coreutils pkgs.gawk pkgs.jq ];
    text = ''
      for dir in /proc/[0-9]*; do
        pss=$(awk '/^Pss:/ { print $2 }' "$dir/smaps_rollup" 2>/dev/null) || continue
        name=$(cat "$dir/comm" 2>/dev/null) || continue
        [ -n "$pss" ] && printf '%s\t%s\n' "$pss" "$name"
      done |
        awk -F'\t' '{ sum[$2] += $1 } END { for (name in sum) printf "%d\t%s\n", sum[name], name }' |
        sort -rn | head -25 |
        jq -R -s 'split("\n") | map(select(length > 0) | split("\t") | { pssKib: (.[0] | tonumber), name: .[1] })'
    '';
  };

  # Runs a command in the environment the desktop gives its apps: the
  # compositor's own, its Wayland socket and the user bus.
  inSession = compositor: pkgs.writeShellApplication {
    name = "in-session";
    runtimeInputs = [ pkgs.procps pkgs.coreutils ];
    text = ''
      pid=$(pgrep -u alice -o -f '${compositor}')
      while IFS= read -r -d "" var; do
        case "$var" in
          DOMICILE_* | XDG_* | DBUS_* | WAYLAND_*) export "''${var?}" ;;
        esac
      done <"/proc/$pid/environ"
      export XDG_RUNTIME_DIR=/run/user/1000
      # A tty login says `tty`, and Chromium's ozone hint then picks X11:
      # the apps would run in Xwayland rather than on the desktop.
      export XDG_SESSION_TYPE=wayland
      export DBUS_SESSION_BUS_ADDRESS="''${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/1000/bus}"
      sockets=(/run/user/1000/wayland-[0-9])
      WAYLAND_DISPLAY=$(basename "''${sockets[0]}")
      export WAYLAND_DISPLAY
      # nixpkgs' Chromium, Slack and VSCodium wrappers run on Wayland with it.
      export NIXOS_OZONE_WL=1
      export PATH="/etc/profiles/per-user/alice/bin:/run/current-system/sw/bin:$PATH"
      exec "$@"
    '';
  };

  # What every desktop's apps are run with when Domicile isn't the desktop.
  ownApps = {
    browser = [
      ([ "chromium" "--no-first-run" "--no-default-browser-check" "--password-store=basic"
         "--remote-debugging-port=9222" ] ++ pages)
    ];
    browserDevtoolsPort = 9222;
    slack = [ "slack" "--password-store=basic" "--remote-debugging-port=9223" "@LINK@" ];
    slackDevtoolsPort = 9223;
    editor = [ "codium" "--disable-workspace-trust" "--password-store=basic" "${project}" ];
  };

  ttyLogin = command: {
    services.getty.autologinUser = "alice";
    environment.loginShellInit = ''
      if [ "$(tty)" = /dev/tty1 ]; then
        ${command}
      fi
    '';
  };

  # `gpu`: drawn on the host's card through virgl, rather than in software.
  desktops = gpu: {
    # No desktop: what the VM itself costs.
    console = {
      compositor = null;
      apps = ownApps;
      module = ttyLogin "true";
    };

    domicile = {
      compositor = "bin/domicile-compositor";
      apps = {
        browser = map (page: [ "domicile" "open" page ]) pages;
        browserDevtoolsPort = 9222;
        slack = [ "domicile" "open" "@LINK@" ];
        slackDevtoolsPort = 9222;
        editor = [ "domicile" "open" "--electron" "codium.desktop" "--"
                   "codium" "--disable-workspace-trust" "${project}" ];
      };
      module.imports = [
        {
          imports = [ self.nixosModules.domicile ];
          programs.domicile.enable = true;
          xdg.portal.enable = true;
          users.users.alice.extraGroups = [ "domicile" ];
        }
        (ttyLogin (
          let
            config = pkgs.writeText "domicile.json" (builtins.toJSON {
              electron.apps = [ "slack.desktop" "codium.desktop" ];
            });
          in
          ''
            mkdir -p ~/.config/domicile
            cp ${config} ~/.config/domicile/domicile.json
            export DOMICILE_ENGINE_ARGS="--remote-debugging-port=9222"
            exec ${self.packages.${system}.manganese}/bin/manganese >/tmp/desktop.log 2>&1
          ''))
      ];
    };

    sway = {
      compositor = "bin/sway";
      apps = ownApps;
      module.imports = [
        { programs.sway.enable = true; }
        # pixman: the CPU renderer, for a card with no 3D.
        (ttyLogin "${lib.optionalString (!gpu) "WLR_RENDERER=pixman "}exec sway >/tmp/desktop.log 2>&1")
      ];
    };

    hyprland = {
      compositor = "Hyprland";
      apps = ownApps;
      module.imports = [
        { programs.hyprland.enable = true; }
        (ttyLogin "exec Hyprland >/tmp/desktop.log 2>&1")
      ];
    };

    gnome = {
      compositor = "bin/gnome-shell";
      apps = ownApps;
      module = {
        services.displayManager.gdm.enable = true;
        services.displayManager.autoLogin = { enable = true; user = "alice"; };
        services.desktopManager.gnome.enable = true;
        # First-run screens a user dismisses once.
        services.gnome.gnome-initial-setup.enable = false;
        environment.gnome.excludePackages = [ pkgs.gnome-tour ];
      };
    };

    plasma = {
      compositor = "kwin_wayland";
      apps = ownApps;
      module = {
        services.displayManager.sddm = { enable = true; wayland.enable = true; };
        services.displayManager.autoLogin = { enable = true; user = "alice"; };
        services.displayManager.defaultSession = "plasma";
        services.desktopManager.plasma6.enable = true;
        # A first-run screen a user dismisses once.
        environment.plasma6.excludePackages = [ pkgs.kdePackages.plasma-welcome ];
      };
    };
  };

  # Identical for every desktop: the machine, the network, the apps.
  machine = gpu: name: desktop: { lib, ... }: {
    imports = [ desktop.module ];
    hardware.graphics.enable = lib.mkIf gpu true;
    virtualisation = {
      memorySize = 8192;
      cores = 4;
      diskSize = 8192;
      # See `tty-on-a-card-with-no-3d` in flake.nix.
      useNixStoreImage = true;
      # With `gpu`, a 3D card that virgl draws on the host's GPU. The host
      # picks that GPU's render node at run time (bin/run.sh).
      qemu.options = [
        "-vga none"
        "-device ${if gpu then "virtio-vga-gl" else "virtio-gpu-pci"},xres=1920,yres=1080"
      ];
    };
    # QEMU's user network, eth0, out to the internet: the apps load live pages.
    networking.interfaces.eth0.ipv4.addresses = [ { address = "10.0.2.15"; prefixLength = 24; } ];
    networking.defaultGateway = lib.mkForce { address = "10.0.2.2"; interface = "eth0"; };
    networking.nameservers = lib.mkForce [ "10.0.2.3" ];
    users.users.alice = {
      isNormalUser = true;
      uid = 1000;
      extraGroups = [ "video" "input" ];
    };
    environment.systemPackages = [
      sample
      top
      pkgs.curl
      pkgs.chromium
      unfree.slack
      pkgs.vscodium
    ]
    # For proof of what draws: `eglinfo` names the GL renderer.
    ++ lib.optional gpu pkgs.mesa-demos
    ++ lib.optional (desktop.compositor != null) (inSession desktop.compositor);
    fonts.enableDefaultPackages = true;
    system.name = "benchmark-${name}";
  };

  driver = gpu: name: desktop: (pkgs.testers.runNixOSTest {
    name = "benchmark-${name}${lib.optionalString gpu "-gpu"}";
    # The VM tests' QEMU has no OpenGL, so no virgl.
    qemu.package = lib.mkIf gpu pkgs.qemu_kvm;
    nodes.machine = machine gpu name desktop;
    testScript = builtins.replaceStrings [ "@DESKTOP@" ] [
      (builtins.toJSON ({ inherit gpu name pages; inherit (desktop) compositor; } // desktop.apps))
    ] (builtins.readFile ./vm/benchmark.py);
  }).driver;

  # Signs in to the benchmark's Slack workspace once and prints a one-time
  # link that signs the desktop app in.
  slackMagicLink = pkgs.writeShellApplication {
    name = "slack-magic-link";
    runtimeEnv.PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
    text = ''
      exec ${pkgs.python3.withPackages (ps: [ ps.playwright ])}/bin/python3 -I ${./bin/slack-magic-link.py} "$@"
    '';
  };

  run = pkgs.writeShellApplication {
    name = "benchmark";
    runtimeInputs = [ slackMagicLink pkgs.coreutils ];
    text = builtins.readFile ./bin/run.sh;
  };
in
{
  drivers = builtins.mapAttrs (driver false) (desktops false);
  # For a host with a GPU, such as crux.
  gpuDrivers = builtins.mapAttrs (driver true) (desktops true);
  inherit run slackMagicLink;
}
