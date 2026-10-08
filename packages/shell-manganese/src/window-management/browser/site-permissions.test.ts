import { describe, expect, it } from "bun:test";

import { permissionsAsked, sitePermissionsOf } from "./site-permissions";

describe("sitePermissionsOf", () => {
  it("lists each permission the engine reports, in the SDK's order", () => {
    expect(
      sitePermissionsOf({
        camera: "allow",
        location: "ask",
        microphone: "block",
      }),
    ).toStrictEqual([
      { permission: "camera", setting: "allow" },
      { permission: "microphone", setting: "block" },
      { permission: "location", setting: "ask" },
    ]);
  });

  it("lists none for a page with no site", () => {
    expect(sitePermissionsOf({})).toStrictEqual([]);
  });

  // A newer engine may offer one this shell cannot name.
  it("leaves out a permission it does not know", () => {
    expect(sitePermissionsOf({ camera: "ask", teleport: "ask" })).toStrictEqual(
      [{ permission: "camera", setting: "ask" }],
    );
  });

  it("throws for a setting it does not know", () => {
    expect(() => sitePermissionsOf({ camera: "sometimes" })).toThrow();
  });
});

describe("permissionsAsked", () => {
  it("reads what a request asks for", () => {
    expect(permissionsAsked(["camera", "microphone"])).toStrictEqual([
      "camera",
      "microphone",
    ]);
  });

  // Thrown before the request is claimed, so the engine ignores it.
  it("throws for a permission it cannot show", () => {
    expect(() => permissionsAsked(["teleport"])).toThrow();
  });
});
