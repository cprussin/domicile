import { domicilePreset } from "@domicile-desktop/component-library/pandacss-preset";
import { batteryPreset } from "@domicile-desktop/manganese-bar-module-battery/panda-preset";
import { notificationsPreset } from "@domicile-desktop/manganese-bar-module-notifications/panda-preset";
import { launcherPreset } from "@domicile-desktop/manganese-launcher/panda-preset";
import { lockPreset } from "@domicile-desktop/manganese-lock/panda-preset";
import { windowManagementPreset } from "@domicile-desktop/manganese-window-management/panda-preset";
import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  exclude: [],
  // The desktop never scrolls. It spans every display, so it is wider than the
  // viewport, and every position taken from `getBoundingClientRect` would be
  // off by a scroll's offset. The root's `clip` reaches the viewport as
  // `hidden`, which script can still scroll: focusing something off screen
  // would. So the shell focuses with `preventScroll`.
  //
  // `:root` rather than `html`: a selector here replaces the preset's rules for
  // it, and the preset's `html` rules paint the page's background.
  globalCss: {
    ":root": {
      overflow: "clip",
      // Shell chrome is not selectable text. Set at the root so new chrome is
      // covered too. Window pages are separate documents and are unaffected.
      userSelect: "none",
    },
    "html, body, #root": {
      blockSize: "100%",
    },
    // Fields stay selectable so they can be edited.
    "input, textarea": {
      userSelect: "text",
    },
  },
  hash: true,
  // The shell renders component-library controls and manganese's packages, so
  // it must scan their source to emit their CSS rules. Hashing is deterministic
  // per preset, so their runtime class names match the rules generated here.
  include: [
    "./src/**/*.{ts,tsx}",
    "../../packages/component-library/src/**/*.{ts,tsx}",
    "../../packages/manganese-*/src/**/*.{ts,tsx}",
  ],
  jsxFramework: "react",
  outdir: "styled-system",
  preflight: true,
  presets: [
    domicilePreset,
    windowManagementPreset,
    launcherPreset,
    lockPreset,
    batteryPreset,
    notificationsPreset,
  ],
});
