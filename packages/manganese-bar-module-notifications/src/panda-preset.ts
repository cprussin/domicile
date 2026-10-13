import { definePreset } from "@pandacss/dev";

/** Keyframes for the notification bell. */
export const notificationsPreset = definePreset({
  name: "@domicile-desktop/manganese-bar-module-notifications",
  theme: {
    extend: {
      keyframes: {
        // The bar's bell on a new notification. Runs once per arrival, not
        // on a loop, since the toast already shows the notification.
        bellRing: {
          "0%": { transform: "rotate(0)" },
          "15%": { transform: "rotate(14deg)" },
          "30%": { transform: "rotate(-12deg)" },
          "45%": { transform: "rotate(8deg)" },
          "60%": { transform: "rotate(-5deg)" },
          "75%": { transform: "rotate(2deg)" },
          "100%": { transform: "rotate(0)" },
        },
      },
    },
  },
});
