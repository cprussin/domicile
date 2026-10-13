import { definePreset } from "@pandacss/dev";

/** Keyframes for the battery readout. */
export const batteryPreset = definePreset({
  name: "@domicile-desktop/manganese-bar-module-battery",
  theme: {
    extend: {
      keyframes: {
        // A nearly empty battery. Unlike the preset's `pulse`, it returns to
        // full opacity each cycle so the readout stays legible.
        //
        // Animates opacity, not color, so the `danger` token alone sets the
        // color and one animation covers the whole readout.
        chargeFlashing: {
          "0%": { opacity: "1" },
          "50%": { opacity: "{opacity.pulseMin}" },
          "100%": { opacity: "1" },
        },
      },
    },
  },
});
