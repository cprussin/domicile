import { describe, expect, it } from "bun:test";
import type { HostNavigator } from "./connect-to-host";
import { connectToHost, hasHost } from "./connect-to-host";
import type { DomicileHost } from "./domicile-host";

/**
 * As much of a `DomicileHost` as identity requires.
 *
 * Nothing here calls it: what these tests are about is *which* object comes
 * back, and what the one the SDK makes up does when there is none.
 */
const aHost = (): DomicileHost => ({ displays: [] }) as unknown as DomicileHost;

const navigatorWith = (domicile: DomicileHost | null | undefined) =>
  ({ domicile }) as HostNavigator;

describe("connectToHost", () => {
  it("hands back the compositor when there is one", () => {
    // Identity, not equality: everything downstream registers listeners on
    // this object, and a copy would be an object nothing dispatches to.
    const host = aHost();

    expect(connectToHost(navigatorWith(host), () => undefined)).toBe(host);
  });

  it("says so, once and in as many words, when there is none", async () => {
    // A shell's page opened in an ordinary browser has no compositor and must
    // still render — that is how a shell is styled and laid out without a
    // desktop running. What it must not do is fail *quietly*: a page whose
    // windows never appear is indistinguishable from a compositor with no
    // clients, from a layout bug, and from a client that never drew, and this
    // is the only layer that knows which.
    const said = await new Promise<string>((resolve) => {
      connectToHost(navigatorWith(undefined), resolve);
    });

    expect(said).toContain("navigator.domicile");
  });

  it("reads a null compositor as no compositor", () => {
    // Both absences are real and they are not the same shape. The property is
    // missing outright on a stock browser; the fork's own accessor answers
    // `null` for a document with no frame. A shell that tested only for
    // `undefined` would take the second one for a host and call methods on it.
    const said: string[] = [];

    connectToHost(navigatorWith(null), (message) => said.push(message));

    expect(said).toHaveLength(1);
  });

  it("gives back something inert rather than nothing at all", () => {
    // The stand-in has to satisfy everything a real host does, because the
    // bridge registers its listeners on whatever it is given and does it in
    // its constructor. Throwing here — or handing back `undefined` — would
    // turn "no desktop" into "no page".
    const host = connectToHost(navigatorWith(undefined), () => undefined);

    expect(() => {
      host.addEventListener("appappeared", () => undefined);
      host.spawn(["kitty"]);
      host.focusChrome();
    }).not.toThrow();
  });

  it("describes no desktop, because nothing ever will", () => {
    // Empty is what the engine's own attribute starts as, and here it is also
    // where it ends: a shell reads it as "not described yet" and takes the
    // viewport's geometry instead — see `hasHost`, which is the question it
    // asks to know that.
    expect(
      connectToHost(navigatorWith(undefined), () => undefined).displays,
    ).toStrictEqual([]);
  });
});

describe("hasHost", () => {
  it("is true when the engine put a compositor on this page", () => {
    expect(hasHost(navigatorWith(aHost()))).toBeTrue();
  });

  // The one case a shell has to get right: with no compositor there is no
  // display to lay windows out on, so a shell takes the viewport's geometry
  // instead. Asked of `navigator` rather than of `location`, which is what it
  // used to be — the page's scheme said whether a *bridge* was serving it, and
  // there is no bridge any more.
  it("is false when there is not, however that is spelled", () => {
    expect(hasHost(navigatorWith(undefined))).toBeFalse();
    expect(hasHost(navigatorWith(null))).toBeFalse();
  });
});
