# @domicile-desktop/benchmarks

Measures Domicile's memory and CPU against other Wayland desktops, each in an
identical NixOS VM.

```sh
nix build .#benchmarks.drivers.sway -o driver
nix run .#benchmarks.run -- sway ./driver results 3
bun packages/benchmarks/src/main.ts results
```

`benchmarks.yml` runs every desktop on GitHub's runners when started by hand.

## Desktops

`console` (no desktop, the VM's own cost), `domicile` (manganese), `sway`,
`hyprland`, `gnome` and `plasma`, each as its NixOS module sets it up. First-run
screens (GNOME's tour, Plasma's welcome) are left out.

## Workloads

- **rest**: the desktop alone.
- **chat-and-web**: Slack signed in, and a browser on three pages.
- **chat-web-and-editor**: the same, plus VSCodium on a project.

On Domicile, the pages are browser windows of its engine, and Slack and
VSCodium run on the engine through `electron-host`. Elsewhere, Chromium,
Slack's Electron and VSCodium's Electron run on their own.

## A run

- A fresh boot per run: 4 cores, 8 GiB, a 2D `virtio-gpu` card at 1920x1080,
  so every desktop renders on the CPU.
- The desktop settles for 2 minutes, the apps start, then settle 2 more.
- Every 10 seconds for 5 minutes the VM records memory in use
  (`MemTotal - MemAvailable`), the PSS of every process and of the user's,
  CPU ticks and the load average.
- The apps load live pages, so the network adds variance.

`src/main.ts` reports the median run of each and its range.

## Slack

`bin/slack-magic-link.py` signs in to the test workspace on the web with
`BENCH_SLACK_WORKSPACE` (its subdomain), `BENCH_SLACK_EMAIL` and
`BENCH_SLACK_PASSWORD`, then fetches the one-time `slack://` link that signs
the desktop app in. On failure it saves the page to `BENCH_SLACK_DEBUG`.
