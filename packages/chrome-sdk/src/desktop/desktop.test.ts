import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";

describe("desktop", () => {
  it("is one object per host", () => {
    const { host } = new FakeDomicileHost();

    expect(desktop(host)).toBe(desktop(host));
  });

  it("says the compositor was replaced", async () => {
    const fake = new FakeDomicileHost();
    const replaced = new Promise((resolve) => {
      desktop(fake.host).on("compositorreplaced", () => {
        resolve(undefined);
      });
    });
    fake.dispatch("compositorreplaced");

    expect(await replaced).toBeUndefined();
  });
});
