import { definePreset } from "@pandacss/dev";

// A side-to-side shake that dies down.
const LOCK_REFUSED = {
  "0%, 100%": { transform: "translateX(0)" },
  "15%": { transform: "translateX(calc(-1 * {spacing.3}))" },
  "35%": { transform: "translateX({spacing.2.5})" },
  "55%": { transform: "translateX(calc(-1 * {spacing.1.5}))" },
  "75%": { transform: "translateX({spacing.1})" },
};

/** Keyframes for the lock screen. */
export const lockPreset = definePreset({
  name: "@domicile-desktop/manganese-lock",
  theme: {
    extend: {
      keyframes: {
        // The lock screen shakes on a rejected passphrase. Registered under
        // two names so a second rejection restarts it; see `shaken` in
        // `Lock.tsx`.
        lockRefused: LOCK_REFUSED,
        lockRefusedAgain: LOCK_REFUSED,
      },
    },
  },
});
