import { describe, expect, it } from "bun:test";

import { ConnectionSafety, connectionSafety } from "./connection-safety";

describe("connectionSafety", () => {
  it("reads https as a page that was asked for over TLS", () => {
    expect(connectionSafety("https://example.com/one")).toBe(
      ConnectionSafety.Encrypted,
    );
  });

  it("reads http as a page that was asked for in the clear", () => {
    expect(connectionSafety("http://example.com")).toBe(ConnectionSafety.Plain);
  });

  it("reads a scheme that never goes over a wire as neither", () => {
    // `about:blank` and this desktop's own `domicile:` are not a connection at
    // all, so a lock on them would be saying something about nothing and a
    // warning on them would be a lie.
    expect(connectionSafety("about:blank")).toBe(ConnectionSafety.Local);
    expect(connectionSafety("domicile://shell/")).toBe(ConnectionSafety.Local);
    expect(connectionSafety("file:///etc/hosts")).toBe(ConnectionSafety.Local);
  });

  it("refuses an address that is not one", () => {
    // Every address that reaches here was made by `typedAddress` or opened by
    // the shell, so one that will not parse is a bug upstream rather than a
    // case to draw an icon for.
    expect(() => connectionSafety("not an address")).toThrow();
  });
});
