import { describe, expect, it } from "bun:test";
import type { HostGlobal } from "./connect-to-host";
import { connectToHost, hasHost } from "./connect-to-host";
import type { DomicileHost } from "./domicile-host";

/** A fake `DomicileHost` for identity checks; no member is called. */
const aHost = (): DomicileHost => ({ displays: [] }) as unknown as DomicileHost;

const globalWith = (domicile: DomicileHost | null | undefined) =>
  ({ domicile }) as HostGlobal;

describe("connectToHost", () => {
  it("hands back the compositor when there is one, off either global", () => {
    // Identity, not equality: listeners must go on the real host.
    //
    // The `satisfies` checks that the SDK declares `domicile` on `Window` and
    // `Navigator`; `test:types` fails if either declaration is dropped.
    const host = aHost();
    const page = { domicile: host } satisfies Pick<Window, "domicile">;
    const nav = { domicile: host } satisfies Pick<Navigator, "domicile">;

    expect(connectToHost(page, () => undefined)).toBe(host);
    expect(connectToHost(nav, () => undefined)).toBe(host);
  });

  it("says so, once and in as many words, when there is none", async () => {
    // Without a warning, missing windows look like a shell or client bug.
    const said = await new Promise<string>((resolve) => {
      connectToHost(globalWith(undefined), resolve);
    });

    expect(said).toContain("window.domicile");
  });

  it("reads a null compositor as no compositor", () => {
    // The engine returns `null` for a document with no frame; a stock browser
    // has no property at all.
    const said: string[] = [];

    connectToHost(globalWith(null), (message) => said.push(message));

    expect(said).toHaveLength(1);
  });

  it("gives back something inert rather than nothing at all", () => {
    // The client registers listeners in its constructor, so the stand-in must
    // not throw or the page would fail to render.
    const host = connectToHost(globalWith(undefined), () => undefined);

    expect(() => {
      host.addEventListener("appappeared", () => undefined);
      host.spawn(["kitty"]);
      host.focusChrome();
    }).not.toThrow();
  });

  it("describes no desktop, because nothing ever will", () => {
    // `null` means "not described", matching the engine before a desktop is
    // described. `[]` would mean a desktop with no screens.
    expect(
      connectToHost(globalWith(undefined), () => undefined).displays,
    ).toBeNull();
  });
});

describe("hasHost", () => {
  it("is true when the engine put a compositor on this page", () => {
    expect(hasHost(globalWith(aHost()))).toBeTrue();
  });

  // A shell uses this to fall back to the viewport's geometry.
  it("is false when there is not, however that is spelled", () => {
    expect(hasHost(globalWith(undefined))).toBeFalse();
    expect(hasHost(globalWith(null))).toBeFalse();
  });
});
