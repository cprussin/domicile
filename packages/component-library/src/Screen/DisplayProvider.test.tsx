import { describe, expect, it } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import {
  DisplayProvider,
  useDisplays,
  useScreenRegion,
} from "./DisplayProvider";
import type { Display, DisplaySource } from "./display-source";

/** A display source that never sends a display list. */
const silent = (): DisplaySource => ({
  displays: undefined,
  onDisplays: () => () => undefined,
});

/** A source that received `displays` before the provider mounted. */
const alreadyTold = (displays: readonly Display[]): DisplaySource => ({
  displays,
  onDisplays: () => () => undefined,
});

/** A source updated after mount, through the returned setter. */
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

/** Formats a display list as one line; `(never told)` for `undefined`. */
const asText = (displays: readonly Display[] | undefined): string =>
  displays === undefined
    ? "(never told)"
    : displays.map((display) => display.name).join(" ");

/** Renders what `useDisplays` returned. */
const Reader = () => <span data-testid="read">{asText(useDisplays())}</span>;

/** Records what `useDisplays` returned on every render, including the first. */
const Recorder = ({ into }: { into: string[] }) => {
  const displays = useDisplays();
  into.push(asText(displays));
  return <span data-testid="read">{asText(displays)}</span>;
};

const read = (): string => screen.getByTestId("read").textContent ?? "";

describe("useDisplays", () => {
  it("throws outside a provider, rather than pretending there are none", () => {
    // Otherwise a missing provider renders a blank page with no error.
    expect(() => {
      render(<Reader />);
    }).toThrow(/DisplayProvider/);
  });

  it("says nothing yet while the host has not described the desktop", () => {
    // Distinct from an empty list, or a shell briefly shows its "no screens"
    // state while connecting.
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
    // The host sends displays only on connect and on change, so a provider
    // that only subscribed could show none indefinitely.
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
    // Reading the source in an effect settles on the same DOM, but the first
    // render would show an empty desktop.
    const renders: string[] = [];
    render(
      <DisplayProvider source={alreadyTold([LEFT, RIGHT])}>
        <Recorder into={renders} />
      </DisplayProvider>,
    );
    expect(renders[0]).toBe("left right");
  });

  it("takes up the desktop of a source that replaces the one before it", () => {
    // The new source may already hold displays, and `useState`'s initializer
    // runs only once.
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
    // `DomicileClient.on` holds a single handler, so re-registering on every
    // render would churn it.
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
    // The source outlives the provider. Asserted on the source, because React
    // only logs updates to an unmounted tree.
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
    // A `DomicileClient` replays its last value to the first handler, so an
    // adapter calls back inside `onDisplays`.
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
    // Otherwise the old source keeps overwriting the new one's displays.
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

describe("useScreenRegion", () => {
  /** Renders the region `useScreenRegion` returned, as JSON. */
  const RegionReader = ({ name }: { name: string | undefined }) => (
    <span data-testid="read">
      {JSON.stringify(useScreenRegion(name)) ?? "(the page)"}
    </span>
  );

  it("is the rectangle of the display it names, in the page's pixels", () => {
    render(
      <DisplayProvider source={alreadyTold([LEFT, RIGHT])}>
        <RegionReader name="right" />
      </DisplayProvider>,
    );
    expect(JSON.parse(read())).toStrictEqual({
      height: "1440px",
      left: "1920px",
      top: "0px",
      width: "2560px",
    });
  });

  it("is the page for no display, and needs no provider for it", () => {
    render(<RegionReader name={undefined} />);
    expect(read()).toBe("(the page)");
  });

  it("is the page for a display that has gone from the desktop", () => {
    // An unplugged monitor disappears a render before the shell moves off
    // it, and that render must not throw.
    render(
      <DisplayProvider source={alreadyTold([LEFT])}>
        <RegionReader name="right" />
      </DisplayProvider>,
    );
    expect(read()).toBe("(the page)");
  });

  it("throws for a display named outside a provider", () => {
    expect(() => {
      render(<RegionReader name="right" />);
    }).toThrow(/DisplayProvider/);
  });
});
