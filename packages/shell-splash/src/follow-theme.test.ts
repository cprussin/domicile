import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { followTheme } from "./follow-theme";

describe(followTheme, () => {
  it("applies the desktop's theme now and on each change", () => {
    const fake = new FakeDomicileHost();
    fake.set({ theme: "light" });
    const stop = followTheme(fake.host);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    fake.set({ theme: "dark" });
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    stop();
  });
});
