import { describe, expect, it } from "bun:test";

import { ConfigKind, configState, whyReadOnly } from "./config-state";
import type { SettingsFiles } from "./host";

const json = (text: string, writable = true): SettingsFiles => ({
  config: { path: "/home/me/.config/domicile/domicile.json", text, writable },
  evaluated: undefined,
  shell: undefined,
});

describe(configState, () => {
  it("edits a JSON config that can be written", () => {
    const state = configState(json('{"theme":{"mode":"light"}}'));
    expect(state.kind).toBe(ConfigKind.Json);
    expect(state.settings?.theme.mode).toBe("light");
    expect(whyReadOnly(state)).toBeUndefined();
  });

  it("shows a read-only config and says why", () => {
    const state = configState(json("{}", false));
    expect(state.settings?.theme.mode).toBe("dark");
    expect(whyReadOnly(state)).toBe(
      "/home/me/.config/domicile/domicile.json is read-only. Change it where it is made, such as your home-manager config.",
    );
  });

  it("shows a module config's values, which only its code can change", () => {
    const state = configState({
      config: {
        path: "/home/me/.config/domicile/domicile.ts",
        text: "export const idle = { blank_after_seconds: 60 };",
        writable: true,
      },
      evaluated: '{"idle":{"blank_after_seconds":60}}',
      shell: undefined,
    });
    expect(state.kind).toBe(ConfigKind.Module);
    expect(state.settings?.idle.blank_after_seconds).toBe(60);
    expect(whyReadOnly(state)).toBe(
      "/home/me/.config/domicile/domicile.ts is code. Change these settings in it under Code.",
    );
  });

  it("shows the defaults of a desktop with no config", () => {
    const state = configState({
      config: undefined,
      evaluated: undefined,
      shell: undefined,
    });
    expect(state.settings?.output.max_scale).toBe(2);
    expect(whyReadOnly(state)).toBe(
      "This desktop has no config file, so it runs the defaults. Start it with one to change them here.",
    );
  });

  it("says why a config cannot be read", () => {
    const state = configState(json('{"theme":'));
    expect(state.kind).toBe(ConfigKind.Unreadable);
    expect(state.settings).toBeUndefined();
    expect(whyReadOnly(state)).toStartWith(
      "/home/me/.config/domicile/domicile.json cannot be read: ",
    );
  });
});
