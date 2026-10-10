import { describe, expect, it } from "bun:test";
import { Ok } from "@cprussin/option-result";

import { readSettings } from "./config-schema";

describe(readSettings, () => {
  it("fills in what a config leaves out as the compositor does", () => {
    expect(readSettings({})).toEqual(
      Ok({
        extensions: { unpacked: [], web_store: [] },
        files: { omit: ["**/.*"] },
        idle: {},
        input: {
          keyboard: {
            xkb_layout: "us",
            xkb_model: "",
            xkb_options: [],
            xkb_rules: "",
            xkb_variant: "",
          },
        },
        lock: {},
        lockdown: {
          disable_application_handlers: false,
          disable_camera: false,
          disable_location: false,
          disable_microphone: false,
          disable_printing: false,
          disable_save_to_disk: false,
          disable_sound_output: false,
        },
        output: { displays: [], max_scale: 2, profiles: [] },
        startup: { commands: [] },
        theme: { contrast: "normal", mode: "dark", reduced_motion: false },
      }),
    );
  });

  it("reads displays and profiles with their own defaults", () => {
    const settings = readSettings({
      output: {
        displays: [{ name: "left", size: [1920, 1080] }],
        profiles: [{ displays: [{ display: "drm-1" }], name: "desk" }],
      },
    });
    expect(settings.map((read) => read.output)).toEqual(
      Ok({
        displays: [
          { name: "left", position: [0, 0], scale: 1, size: [1920, 1080] },
        ],
        max_scale: 2,
        profiles: [
          {
            displays: [
              {
                display: "drm-1",
                enabled: true,
                position: [0, 0],
                scale: 1,
                transform: "normal",
              },
            ],
            name: "desk",
          },
        ],
      }),
    );
  });

  it("says where a config does not fit", () => {
    expect(readSettings({ theme: { mode: "system" } }).isErr()).toBe(true);
    expect(readSettings({ theme: { tint: "red" } }).isErr()).toBe(true);
  });
});
