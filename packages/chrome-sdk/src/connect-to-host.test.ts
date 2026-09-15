import { describe, expect, it } from "bun:test";
import type { HostGlobal } from "./connect-to-host";
import { connectToHost, hasHost } from "./connect-to-host";
import type { DomicileHost } from "./domicile-host";

/**
 * As much of a `DomicileHost` as identity requires.
 *
 * Nothing here calls it: what these tests are about is *which* object comes
 * back, and what the one the SDK makes up does when there is none.
 */
const aHost = (): DomicileHost => ({ displays: [] }) as unknown as DomicileHost;

const globalWith = (domicile: DomicileHost | null | undefined) =>
  ({ domicile }) as HostGlobal;

describe("connectToHost", () => {
  it("hands back the compositor when there is one, off either global", () => {
    // Identity, not equality: everything downstream registers listeners on
    // this object, and a copy would be an object nothing dispatches to.
    //
    // Both spellings, because `window.domicile` is an alias for
    // `navigator.domicile` and not a second host — one object, however a shell
    // reached it. The `satisfies` is where the SDK's own declarations are
    // asserted: `Pick<Window, "domicile">` does not type-check unless the SDK
    // declares the property on `Window`, so `test:types` fails if either
    // declaration is dropped and a shell author loses completion.
    const host = aHost();
    const page = { domicile: host } satisfies Pick<Window, "domicile">;
    const nav = { domicile: host } satisfies Pick<Navigator, "domicile">;

    expect(connectToHost(page, () => undefined)).toBe(host);
    expect(connectToHost(nav, () => undefined)).toBe(host);
  });

  it("says so, once and in as many words, when there is none", async () => {
    // A shell's page opened in an ordinary browser has no compositor and must
    // still render — that is how a shell is styled and laid out without a
    // desktop running. What it must not do is fail *quietly*: a page whose
    // windows never appear is indistinguishable from a compositor with no
    // clients, from a layout bug, and from a client that never drew, and this
    // is the only layer that knows which.
    const said = await new Promise<string>((resolve) => {
      connectToHost(globalWith(undefined), resolve);
    });

    expect(said).toContain("window.domicile");
  });

  it("reads a null compositor as no compositor", () => {
    // Both absences are real and they are not the same shape. The property is
    // missing outright on a stock browser; the fork's own accessor answers
    // `null` for a document with no frame. A shell that tested only for
    // `undefined` would take the second one for a host and call methods on it.
    const said: string[] = [];

    connectToHost(globalWith(null), (message) => said.push(message));

    expect(said).toHaveLength(1);
  });

  it("gives back something inert rather than nothing at all", () => {
    // The stand-in has to satisfy everything a real host does, because the
    // client registers its listeners on whatever it is given and does it in
    // its constructor. Throwing here — or handing back `undefined` — would
    // turn "no desktop" into "no page".
    const host = connectToHost(globalWith(undefined), () => undefined);

    expect(() => {
      host.addEventListener("appappeared", () => undefined);
      host.spawn(["kitty"]);
      host.focusChrome();
    }).not.toThrow();
  });

  it("describes no desktop, because nothing ever will", () => {
    // `null`, which is what the engine's own attribute says before a desktop
    // has been described — and here it is also where it ends. Not `[]`: that
    // claims a desktop with no screens on it, which is a description, and
    // nothing here has described anything. A shell reads this as "not
    // described yet" and takes the viewport's geometry instead — see
    // `hasHost`, which is the question it asks to know that.
    expect(
      connectToHost(globalWith(undefined), () => undefined).displays,
    ).toBeNull();
  });
});

describe("hasHost", () => {
  it("is true when the engine put a compositor on this page", () => {
    expect(hasHost(globalWith(aHost()))).toBeTrue();
  });

  // The one case a shell has to get right: with no compositor there is no
  // display to lay windows out on, so a shell takes the viewport's geometry
  // instead. Asked of the global rather than of `location`, which is what it
  // used to be — the page's scheme said whether a *bridge* was serving it, and
  // there is no bridge any more.
  it("is false when there is not, however that is spelled", () => {
    expect(hasHost(globalWith(undefined))).toBeFalse();
    expect(hasHost(globalWith(null))).toBeFalse();
  });
});
