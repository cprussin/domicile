import { describe, expect, it } from "bun:test";

import { appIdName } from "./app-id-name";

describe("appIdName", () => {
  it("names a reverse-DNS id by its last part", () => {
    expect(appIdName("com.chromium.Chromium")).toBe("Chromium");
  });

  it("capitalizes the name and spaces its words", () => {
    expect(appIdName("chromium-browser")).toBe("Chromium browser");
    expect(appIdName("org.example.my_app")).toBe("My app");
  });
});
