import { defineOptions, option } from "@domicile-desktop/sdk/options";

/**
 * manganese's options, set under `shell_options` in the config or on the
 * Settings app's Shell page. See `docs/WRITING-A-SHELL.md#options`.
 */
export const options = defineOptions({
  clock: {
    format: option.choice("Clock format", ["24h", "12h"], "24h"),
    seconds: option.toggle("Show seconds", true),
  },
});
