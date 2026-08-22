import { describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import { DisplayProvider, useDisplays } from "./DisplayProvider";
import type { Display, DisplaySource } from "./display-source";

/** A display source that never says anything, standing in for a bridge. */
const silent = (): DisplaySource => ({
  displays: undefined,
  onDisplays: () => () => undefined,
});

/**
 * A source that has already been told, the way a bridge that received
 * `displays` before this provider mounted has.
 */
const alreadyTold = (displays: readonly Display[]): DisplaySource => ({
  displays,
  onDisplays: () => () => undefined,
});

/**
 * A source that is told later, handing back the setter so a test can drive
 * the message that arrives after mount.
 */
const toldLater = (
  already?: readonly Display[],
): {
  listening: () => boolean;
  registrations: () => number;
  source: DisplaySource;
  tell: (displays: readonly Display[]) => void;
} => {
  let listener: ((displays: readonly Display[]) => void) | undefined;
  let registrations = 0;
  return {
    listening: () => listener !== undefined,
    registrations: () => registrations,
    source: {
      displays: already,
      onDisplays: (handler) => {
        registrations += 1;
        listener = handler;
        return () => {
          listener = undefined;
        };
      },
    },
    tell: (displays) => {
      act(() => {
        listener?.(displays);
      });
    },
  };
};

const LEFT: Display = {
  name: "left",
  position: [0, 0],
  scale: 1,
  size: [1920, 1080],
};

const RIGHT: Display = {
  name: "right",
  position: [1920, 0],
  scale: 2,
  size: [2560, 1440],
};

/** How a desktop reads as one line, `(never told)` being its absence. */
const asText = (displays: readonly Display[] | undefined): string =>
  displays === undefined
    ? "(never told)"
    : displays.map((display) => display.name).join(" ");

/** Renders what `useDisplays` returned, so a test can read it out of the DOM. */
const Reader = () => <span data-testid="read">{asText(useDisplays())}</span>;

/**
 * Records what `useDisplays` returned on *every* render, so a test can see the
 * first one rather than only what the DOM settled on.
 */
const Recorder = ({ into }: { into: string[] }) => {
  const displays = useDisplays();
  into.push(asText(displays));
  return <span data-testid="read">{asText(displays)}</span>;
};

const read = (): string => screen.getByTestId("read").textContent ?? "";

describe("useDisplays", () => {
  it("throws outside a provider, rather than pretending there are none", () => {
    // A shell that forgot the provider would otherwise lay every `<Screen>`
    // out against an empty desktop and render a blank page with no symptom.
    expect(() => {
      render(<Reader />);
    }).toThrow(/DisplayProvider/);
  });

  it("says nothing yet while the host has not described the desktop", () => {
    // Not an empty desktop: a handshake still in flight and a desktop with no
    // screens are different states, and collapsing them makes a shell render
    // its "no screens" case for the fraction of a second before the answer.
    render(
      <DisplayProvider source={silent()}>
        <Reader />
      </DisplayProvider>,
    );
    expect(read()).toBe("(never told)");
  });

  it("says a desktop of no screens is a desktop, not a silence", () => {
    render(
      <DisplayProvider source={alreadyTold([])}>
        <Reader />
      </DisplayProvider>,
    );
    expect(read()).toBe("");
  });

  it("reads displays the source was told before it mounted", () => {
    // The host describes the desktop on connecting and again on every change,
    // latest wins — so a provider that only listened would lay out against an
    // empty desktop from mounting until the next change, and on a desktop
    // nobody is resizing there is no next change.
    render(
      <DisplayProvider source={alreadyTold([LEFT, RIGHT])}>
        <Reader />
      </DisplayProvider>,
    );
    expect(read()).toBe("left right");
  });

  it("takes the displays the source is told after it mounted", () => {
    const { source, tell } = toldLater();
    render(
      <DisplayProvider source={source}>
        <Reader />
      </DisplayProvider>,
    );
    expect(read()).toBe("(never told)");
    tell([LEFT, RIGHT]);
    expect(read()).toBe("left right");
  });

  it("has the desktop on the very first render, not one paint later", () => {
    // Seeding state from the source is what makes this true; catching up in an
    // effect settles on the same answer, so the settled DOM cannot tell them
    // apart. What differs is the render in between — every `<Screen>` matching
    // nothing, which a shell shows as an empty desktop that then pops.
    const renders: string[] = [];
    render(
      <DisplayProvider source={alreadyTold([LEFT, RIGHT])}>
        <Recorder into={renders} />
      </DisplayProvider>,
    );
    expect(renders[0]).toBe("left right");
  });

  it("takes up the desktop of a source that replaces the one before it", () => {
    // A source is a connection. A new one is a new desktop, and it may have
    // been described already — `useState`'s initialiser runs once, so nothing
    // but re-reading it here would carry the old connection's screens over.
    const { source: first } = toldLater([LEFT]);
    const { source: second } = toldLater([RIGHT]);
    const { rerender } = render(
      <DisplayProvider source={first}>
        <Reader />
      </DisplayProvider>,
    );
    expect(read()).toBe("left");
    rerender(
      <DisplayProvider source={second}>
        <Reader />
      </DisplayProvider>,
    );
    expect(read()).toBe("right");
  });

  it("registers once for a source that does not change", () => {
    // `BridgeClient.on` is a single slot and a source is the connection, so a
    // provider that re-registered on every render would churn the one
    // registration the page has.
    const { registrations, source } = toldLater();
    const { rerender } = render(
      <DisplayProvider source={source}>
        <Reader />
      </DisplayProvider>,
    );
    rerender(
      <DisplayProvider source={source}>
        <Reader />
      </DisplayProvider>,
    );
    expect(registrations()).toBe(1);
  });

  it("stops listening when it goes away", () => {
    // The source outlives the provider — it is the connection — so nothing but
    // the teardown stops it setting state on a tree that is gone. Asserted on
    // the source, because React answers an update on an unmounted tree with a
    // console line, and no test can fail on one of those.
    const { listening, source } = toldLater();
    const { unmount } = render(
      <DisplayProvider source={source}>
        <Reader />
      </DisplayProvider>,
    );
    expect(listening()).toBe(true);
    unmount();
    expect(listening()).toBe(false);
  });

  it("survives a source that answers registration immediately", () => {
    // A `BridgeClient` replays what it is holding to the first handler that
    // registers, so an adapter over one calls back inside `onDisplays` — with
    // the same desktop the seed just used. Setting state during an effect is
    // fine; the point is that the provider does not care whether the answer
    // arrives during registration or after it.
    const eager: DisplaySource = {
      displays: [LEFT],
      onDisplays: (handler) => {
        handler([LEFT, RIGHT]);
        return () => undefined;
      },
    };
    render(
      <DisplayProvider source={eager}>
        <Reader />
      </DisplayProvider>,
    );
    expect(read()).toBe("left right");
  });

  it("stops listening to a source it has been moved off", () => {
    // Same reason, and the case the teardown is actually for: the provider
    // outlives that connection rather than the other way round, and the old
    // one would otherwise keep overwriting the new desktop. React runs the
    // cleanup before the effect that replaces it, so by the time the second
    // source registers the first is already released.
    const { listening, source: first } = toldLater();
    const { source: second } = toldLater();
    const { rerender } = render(
      <DisplayProvider source={first}>
        <Reader />
      </DisplayProvider>,
    );
    rerender(
      <DisplayProvider source={second}>
        <Reader />
      </DisplayProvider>,
    );
    expect(listening()).toBe(false);
  });
});
