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
      # Steal is time the host gave to its other work (crux runs CI beside
      # the benchmark): not the desktop's, so not busy, but kept apart to
      # show how contended a run was.
      busy=$((user + nice + system + irq + softirq))
      total=$((busy + idle + iowait + steal))
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
      printf '{"busyTicks":%d,"stealTicks":%d,"totalTicks":%d,"usedKib":%d,"load1":%s,"pssKib":%d,"sessionPssKib":%d}\n' \
        "$busy" "$steal" "$total" "$used" "$load" "$all" "$mine"
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

  # Every thread's CPU ticks so far, one per line: a key, a label (program,
  # Chromium's process type, thread), and utime + stime. Read at each end of
  # the window, it says which threads spent the CPU. Also, per process, what
  # its children that exited spent (a program run every few seconds shows up
  # there, under whoever reaped it), and the kernel's interrupt time.
  threads = pkgs.writeShellApplication {
    name = "bench-threads";
    runtimeInputs = [ pkgs.coreutils pkgs.gnugrep ];
    text = ''
      for dir in /proc/[0-9]*; do
        program=$(cat "$dir/comm" 2>/dev/null) || continue
        # Chromium's children rewrite their command line as one string, so
        # the type is found among spaces as well as NULs.
        type=$(tr '\0' ' ' <"$dir/cmdline" 2>/dev/null | grep -o -- '--type=[^ ]*' | head -1) || true
        label="$program''${type:+[''${type#--type=}]}"
        for task in "$dir"/task/[0-9]*; do
          stat=$(cat "$task/stat" 2>/dev/null) || continue
          thread=$(cat "$task/comm" 2>/dev/null) || continue
          # The fields after the name, which can hold spaces: state is the
          # first, so utime and stime are the 12th and 13th, and the
          # children's (process-wide) the 14th and 15th.
          read -r -a fields <<<"''${stat##*) }"
          printf '%s\t%s/%s\t%d\n' "$task" "$label" "$thread" "$((fields[11] + fields[12]))"
        done
        stat=$(cat "$dir/stat" 2>/dev/null) || continue
        read -r -a fields <<<"''${stat##*) }"
        printf '%s/children\t%s/(exited children)\t%d\n' "$dir" "$label" "$((fields[13] + fields[14]))"
      done
      read -r _ _ _ _ _ _ irq softirq _ </proc/stat
      printf 'kernel/irq\t(kernel)/irq\t%d\nkernel/softirq\t(kernel)/softirq\t%d\n' "$irq" "$softirq"
    '';
  };

  # The errors and warnings a DevTools page has logged so far, given its
  # WebSocket address: one line each, its message cut short and its first
  # frame's file (query left off, which can hold tokens) and line. Enabling
  # Runtime and Log replays what the page logged before anyone listened.
  console = pkgs.writeShellApplication {
    name = "bench-console";
    runtimeInputs = [ pkgs.coreutils pkgs.jq pkgs.websocat ];
    text = ''
      { printf '%s\n' '{"id":1,"method":"Runtime.enable"}' '{"id":2,"method":"Log.enable"}'; sleep 3; } |
        timeout 10 websocat -t -B 16777216 "$1" |
        jq -r '
          def where(url; line): " at \((url // "?") | sub("\\?.*"; "")):\(line // "?")";
          def short: tostring | split("\n")[0] | .[0:200];
          if .method == "Runtime.exceptionThrown" then
            .params.exceptionDetails
            | "exception: \((.exception.description // .text) | short)"
              + where(.stackTrace.callFrames[0].url // .url; .stackTrace.callFrames[0].lineNumber // .lineNumber)
          elif .method == "Runtime.consoleAPICalled" and (.params.type == "error" or .params.type == "warning") then
            .params
            | "console.\(.type): \(.args | map(.value // .description // "" | short) | join(" ") | .[0:200])"
              + where(.stackTrace.callFrames[0].url; .stackTrace.callFrames[0].lineNumber)
          elif .method == "Log.entryAdded" and (.params.entry.level == "error" or .params.entry.level == "warning") then
            .params.entry | "log.\(.level): \(.text | short)" + where(.url; .lineNumber)
          else empty end' || true
    '';
  };

  # GNOME Shell takes screenshots and runs `Eval` only from callers it allows
  # by bus name, and gnome-screenshot hung. Its unsafe mode, which GNOME's
  # own tests use, allows any: this extension turns it on.
  gnomeUnsafeMode = pkgs.runCommand "bench-unsafe-mode" { } ''
    dir=$out/share/gnome-shell/extensions/bench-unsafe-mode@domicile-desktop.com
    mkdir -p $dir
    cat >$dir/metadata.json <<'JSON'
    {
      "uuid": "bench-unsafe-mode@domicile-desktop.com",
      "name": "Benchmark unsafe mode",
      "description": "Lets the benchmark take screenshots and focus windows.",
      "shell-version": ["${lib.versions.major pkgs.gnome-shell.version}"]
    }
    JSON
    cat >$dir/extension.js <<'JS'
    export default class {
      enable() {
        global.context.unsafe_mode = true;
      }

      disable() {
        global.context.unsafe_mode = false;
      }
    }
    JS
  '';

  # A screenshot on GNOME, from the Shell's own D-Bus call.
  gnomeScreenshot = pkgs.writeShellApplication {
    name = "bench-gnome-screenshot";
    runtimeInputs = [ pkgs.glib ];
    text = ''
      reply=$(gdbus call --session --dest org.gnome.Shell.Screenshot \
        --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.Screenshot false false "$1")
      case "$reply" in
        "(true,"*) ;;
        *) echo "the Shell took no screenshot: $reply" >&2; exit 1 ;;
      esac
    '';
  };

  # Gives the keyboard to the window whose class holds `$1`, on GNOME: it
  # doesn't focus a window started without an activation token.
  gnomeFocus = pkgs.writeShellApplication {
    name = "bench-gnome-focus";
    runtimeInputs = [ pkgs.coreutils pkgs.glib ];
    # `global.get_current_time()` is 0 outside an event, and mutter's focus
    # stealing prevention ignores an activation at time 0, so this takes a
    # current timestamp instead, then checks which window has the focus.
    text = ''
      shell_eval() {
        gdbus call --session --dest org.gnome.Shell \
          --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$1"
      }
      reply=$(shell_eval "global.display.list_all_windows().find((w) => (w.get_wm_class() ?? \"\").toLowerCase().includes(\"$1\")).activate(global.display.get_current_time_roundtrip())")
      case "$reply" in
        "(true,"*) ;;
        *) echo "couldn't focus $1: $reply" >&2; exit 1 ;;
      esac
      sleep 0.5
      focused=$(shell_eval "global.display.focus_window?.get_wm_class() ?? 'nothing'")
      case "''${focused,,}" in
        "(true,"*"$1"*) ;;
        *) echo "activated $1, but the focus is on $focused" >&2; exit 1 ;;
      esac
    '';
  };

  # Starts an app the way GNOME Shell's own launcher does, with an activation
  # token from Shell: mutter gives the keyboard only to a window that brings
  # one, and the other desktops here focus a new window anyway.
  gnomeLaunch = pkgs.writeShellApplication {
    name = "bench-gnome-launch";
    runtimeInputs = [ pkgs.glib pkgs.gnused ];
    text = ''
      reply=$(gdbus call --session --dest org.gnome.Shell \
        --object-path /org/gnome/Shell --method org.gnome.Shell.Eval \
        "global.create_app_launch_context(0, -1).get_startup_notify_id(Gio.AppInfo.get_all().find((a) => (a.get_executable() ?? \"\").split(\"/\").pop() === \"$1\"), [])")
      case "$reply" in
        "(true, '\""*) ;;
        *) echo "Shell gave no activation token for $1: $reply" >&2; exit 1 ;;
      esac
      token=$(printf '%s' "$reply" | sed -E "s/^\(true, '\"(.*)\"'\)$/\1/")
      export XDG_ACTIVATION_TOKEN="$token" DESKTOP_STARTUP_ID="$token"
      exec "$@"
    '';
  };

  # Evaluates a JavaScript expression in a DevTools page, given its WebSocket
  # address, awaiting a promise, and prints the value as JSON. With `--front`
  # in place of the expression it instead brings the page's tab to the front
  # and gives it the browser's own focus.
  evaluate = pkgs.writers.writePython3Bin "bench-eval" {
    libraries = [ pkgs.python3Packages.websockets ];
  } ''
    import asyncio
    import json
    import sys

    from websockets.asyncio.client import connect


    async def main(address, expression):
        if expression == "--front":
            request = {"id": 1, "method": "Page.bringToFront"}
        else:
            request = {
                "id": 1,
                "method": "Runtime.evaluate",
                "params": {
                    "expression": expression,
                    "awaitPromise": True,
                    "returnByValue": True,
                },
            }
        async with connect(address, max_size=None) as page:
            await page.send(json.dumps(request))
            while True:
                answer = json.loads(await page.recv())
                if answer.get("id") == 1:
                    break
        if "error" in answer:
            raise RuntimeError(answer["error"])
        result = answer["result"]
        if expression == "--front":
            return
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"])
        print(json.dumps(result["result"].get("value")))


    asyncio.run(main(sys.argv[1], sys.argv[2]))
  '';

  # Runs a command in the environment the desktop gives its apps: the
  # compositor's own, which root copies to /tmp/session-environ first
  # (Hyprland's isn't readable by its own user), its Wayland socket and the
  # user bus.
  inSession = pkgs.writeShellApplication {
    name = "in-session";
    runtimeInputs = [ pkgs.coreutils ];
    text = ''
      while IFS= read -r -d "" var; do
        case "$var" in
          DOMICILE_* | XDG_* | DBUS_* | WAYLAND_*) export "''${var?}" ;;
        esac
      done </tmp/session-environ
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
    editor = [ "codium" "--disable-workspace-trust" "--password-store=basic"
               "--remote-debugging-port=9224" "${project}" ];
    editorDevtoolsPort = 9224;
    # The other desktops show every window they open, so there's nothing to
    # arrange.
    split = null;
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
      screenshot = null;
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
        # Manganese opens each window as a tab of the focused group, so only
        # one would show while the other desktops show them all. Slack, the
        # browser's pages and the editor each get a group, side by side.
        editorDevtoolsPort = 9222;
        split = [ "domicile" "send-shell" "split" "h" ];
        windows = [ "domicile" "list-windows" "--json" ];
      };
      screenshot = [ "domicile" "screenshot" ];
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
              # Like the other desktops at rest: a clock to the minute and
              # one wallpaper, so nothing redraws every second or minute.
              shell_options = {
                clock.seconds = false;
                wallpaper.rotate = false;
              };
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
      screenshot = [ "grim" ];
      module.imports = [
        { programs.sway.enable = true; }
        # pixman: the CPU renderer, for a card with no 3D.
        (ttyLogin "${lib.optionalString (!gpu) "WLR_RENDERER=pixman "}exec sway >/tmp/desktop.log 2>&1")
      ];
    };

    hyprland = {
      compositor = "Hyprland";
      apps = ownApps;
      screenshot = [ "grim" ];
      module.imports = [
        { programs.hyprland.enable = true; }
        (ttyLogin "exec Hyprland >/tmp/desktop.log 2>&1")
      ];
    };

    gnome = {
      compositor = "bin/gnome-shell";
      apps = ownApps;
      screenshot = [ "bench-gnome-screenshot" ];
      launch = [ "bench-gnome-launch" ];
      focusBrowser = [ "bench-gnome-focus" "chromium" ];
      # QEMU's key presses never reach the page under GNOME, though Shell and
      # the page both say it has the keyboard (2026-11-26): no key lag here.
      keyLag = false;
      module = {
        services.displayManager.gdm.enable = true;
        services.displayManager.autoLogin = { enable = true; user = "alice"; };
        services.desktopManager.gnome.enable = true;
        # First-run screens a user dismisses once.
        services.gnome.gnome-initial-setup.enable = false;
        environment.gnome.excludePackages = [ pkgs.gnome-tour ];
        # Never blank or lock the idle screen mid-run: the other desktops
        # here don't, and a lock screen would be what we measure.
        programs.dconf.profiles.user.databases = [{
          settings = {
            "org/gnome/desktop/session".idle-delay = lib.gvariant.mkUint32 0;
            "org/gnome/desktop/screensaver".lock-enabled = false;
            "org/gnome/settings-daemon/plugins/power".sleep-inactive-ac-type = "nothing";
            "org/gnome/shell".enabled-extensions = [ "bench-unsafe-mode@domicile-desktop.com" ];
          };
        }];
      };
    };

    plasma = {
      compositor = "kwin_wayland";
      apps = ownApps;
      # KWin lets only Spectacle read the screen. Background, no notification.
      screenshot = [ "spectacle" "-b" "-n" "-f" "-o" ];
      module = {
        services.displayManager.sddm = { enable = true; wayland.enable = true; };
        services.displayManager.autoLogin = { enable = true; user = "alice"; };
        services.displayManager.defaultSession = "plasma";
        services.desktopManager.plasma6.enable = true;
        # A first-run screen a user dismisses once.
        environment.plasma6.excludePackages = [ pkgs.kdePackages.plasma-welcome ];
        # Never dim, blank or lock the idle screen mid-run: the other
        # desktops here don't, and a lock screen would be what we measure.
        environment.etc."xdg/kscreenlockerrc".text = lib.generators.toINI { } {
          Daemon = { Autolock = false; LockOnResume = false; };
        };
        environment.etc."xdg/powerdevilrc".text = ''
          [AC][Display]
          DimDisplayWhenIdle=false
          TurnOffDisplayWhenIdle=false

          [AC][SuspendAndShutdown]
          AutoSuspendAction=0
        '';
        # With autologin there's no password to open the wallet, so KWallet
        # asks for one, and Slack waits on that dialog forever to store its
        # sign-in. Someone typing their password at login never sees it.
        # (The wait is our best reading of the logs: Slack sat on
        # auth.loginMagicBulk with the wallet daemon up.)
        environment.etc."xdg/kwalletrc".text = lib.generators.toINI { } {
          Wallet = { Enabled = false; };
        };
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
      threads
      console
      evaluate
      pkgs.curl
      pkgs.chromium
      unfree.slack
      pkgs.vscodium
      # Screenshots, taken in the session (see `screenshot` in vm/benchmark.py).
      pkgs.grim
      gnomeScreenshot
      gnomeFocus
      gnomeLaunch
      gnomeUnsafeMode
      pkgs.kdePackages.spectacle
    ]
    # For proof of what draws: `eglinfo` names the GL renderer.
    ++ lib.optional gpu pkgs.mesa-demos
    ++ lib.optional (desktop.compositor != null) inSession;
    fonts.enableDefaultPackages = true;
    system.name = "benchmark-${name}";
  };

  driver = gpu: name: desktop: (pkgs.testers.runNixOSTest {
    name = "benchmark-${name}${lib.optionalString gpu "-gpu"}";
    # The VM tests' QEMU has no OpenGL, so no virgl.
    qemu.package = lib.mkIf gpu pkgs.qemu_kvm;
    nodes.machine = machine gpu name desktop;
    testScript = builtins.replaceStrings [ "@DESKTOP@" ] [
      (builtins.toJSON ({ inherit gpu name pages; inherit (desktop) compositor screenshot; focusBrowser = desktop.focusBrowser or null; launch = desktop.launch or [ ]; keyLag = desktop.keyLag or true; } // desktop.apps))
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
