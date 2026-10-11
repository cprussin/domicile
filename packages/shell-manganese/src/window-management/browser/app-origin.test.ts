import { describe, expect, it } from "bun:test";

import { leftOrigin, siteOf } from "./app-origin";

describe("leftOrigin", () => {
  it("stays on the app's origin across its paths", () => {
    expect(
      leftOrigin("https://music.example/", "https://music.example/album/7"),
    ).toBe(false);
  });

  it("stays on an extension app's origin", () => {
    expect(
      leftOrigin(
        "chrome-extension://settings/settings.html",
        "chrome-extension://settings/other.html",
      ),
    ).toBe(false);
  });

  it("leaves for another host", () => {
    expect(leftOrigin("https://music.example/", "https://login.example/")).toBe(
      true,
    );
  });

  it("leaves for another scheme or port on the same host", () => {
    expect(leftOrigin("https://music.example/", "http://music.example/")).toBe(
      true,
    );
    expect(
      leftOrigin("https://music.example/", "https://music.example:8443/"),
    ).toBe(true);
  });

  // An address the shell cannot read could be anywhere, so the user sees it.
  it("leaves for an address it cannot parse", () => {
    expect(leftOrigin("https://music.example/", "not a url")).toBe(true);
  });
});

describe("siteOf", () => {
  it("is the address's host", () => {
    expect(siteOf("https://login.example:8443/sign-in?next=/")).toBe(
      "login.example:8443",
    );
  });

  it("is the whole address when it has no host", () => {
    expect(siteOf("about:blank")).toBe("about:blank");
  });
});
