import { definePreset } from "@pandacss/dev";

/** Keyframes for the launcher. */
export const launcherPreset = definePreset({
  name: "@domicile-desktop/manganese-launcher",
  theme: {
    extend: {
      keyframes: {
        // A bar of the launcher's now-playing meter. Each bar has its own
        // offset.
        equalizer: {
          "0%": { transform: "scaleY(0.3)" },
          "100%": { transform: "scaleY(1)" },
        },
      },
    },
  },
});
