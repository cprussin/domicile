// The TS config `flake.nix`'s `home-manager-module` check builds. `ms` comes
// from npm, through `bun.nix`.
import ms from "ms";

export const idle = { blank_after_seconds: ms("10m") / 1000 };
export const input = { keyboard: { xkb_layout: "de" } };

export const Shell = (root: HTMLElement): void => {
  root.textContent = "a desktop from a TS config";
};
