import { beforeEach, describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { Measure } from "@domicile/chrome-sdk/measure";
import {
  APP_TAG_NAME,
  registerElements,
} from "@domicile/chrome-sdk/register-elements";
import { render } from "@testing-library/react";
import { AppWindow } from "./AppWindow";

// The elements report their size to a client as they mount, ask it for the
// keyboard when they are clicked, and forward the pointer over them in the
// client's own coordinates. The last two are what is read here — whether the
// keyboard moved and on whose say-so, and what the client was told the pointer
// was over.
let focused: string[] = [];
let motions: (readonly [x: number, y: number])[] = [];

const recordingDomicile = {
  focusApp: (appId: string) => {
    focused.push(appId);
  },
  focusChrome: () => undefined,
  // Recorded only so a click does not throw out of the element's own handler:
  // the button belongs to the client, and nothing here asserts on it.
  pointerButton: () => undefined,
  pointerMotion: (_appId: string, x: number, y: number) => {
    motions.push([x, y]);
  },
  resizeApp: () => undefined,
} as unknown as DomicileClient;

// The test DOM performs no layout, so measurement is injected.
const stubMeasure: Measure = () => ({
  size: [100, 100],
  transform: [1, 0, 0, 1, 0, 0],
  visible: true,
});

const portal = (container: HTMLElement): Element => {
  const element = container.querySelector(APP_TAG_NAME);
  if (element === null) {
    throw new Error("test: the app window rendered no portal");
  } else {
    return element;
  }
};

beforeEach(() => {
  focused = [];
  motions = [];
  registerElements(recordingDomicile, {
    measure: stubMeasure,
    // Otherwise these suites run the SDK's own animation loop, which happy-dom
    // serves as fast as it can: every mounted window re-measured tens of
    // thousands of times a second, for the length of every `await`.
    observePlacement: () => () => {
      // Never turned: nothing here tests what happens when a window moves.
    },
  });
});

describe("AppWindow", () => {
  it("mounts a portal carrying the host's app id", () => {
    const { container } = render(
      <AppWindow
        appId="term"
        clickThrough={false}
        cursor={undefined}
        dragging={false}
        floating={undefined}
        focused
        onReach={() => {
          // Nothing here clicks the window.
        }}
        onScreen
        surfaceSize={undefined}
      />,
    );
    expect(portal(container).getAttribute("app-id")).toBe("term");
  });

  it("answers a click on the window itself rather than letting the SDK", () => {
    // The SDK focuses a clicked client unless something says otherwise, and
    // this shell says otherwise: which window the user is working in is one
    // fact, and it has one owner. Left to the SDK the keyboard would move
    // while the rail went on highlighting the window before it — the same
    // split a browser window had before `onReach`.
    const reached: string[] = [];
    const { container } = render(
      <AppWindow
        appId="term"
        clickThrough={false}
        cursor={undefined}
        dragging={false}
        floating={undefined}
        focused={false}
        onReach={() => {
          reached.push("term");
        }}
        onScreen
        surfaceSize={undefined}
      />,
    );

    portal(container).dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );

    expect(reached).toStrictEqual(["term"]);
    // And the SDK did not take the keyboard on its own account. It moves when
    // the shell says so, which is the `focused` prop coming back.
    expect(focused).toStrictEqual([]);
  });

  it("leaves a click in the window it is already in alone", () => {
    // Reaching what has already been reached. The window the user is in is
    // the one the shell last named, and answering its own clicks would ask it
    // to name that window again on every press.
    const reached: string[] = [];
    const { container } = render(
      <AppWindow
        appId="term"
        clickThrough={false}
        cursor={undefined}
        dragging={false}
        floating={undefined}
        focused
        onReach={() => {
          reached.push("term");
        }}
        onScreen
        surfaceSize={undefined}
      />,
    );

    portal(container).dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );

    expect(reached).toStrictEqual([]);
  });

  it("hides the portal when the window is not on the stage", () => {
    const { container } = render(
      <AppWindow
        appId="term"
        clickThrough={false}
        cursor={undefined}
        dragging={false}
        floating={undefined}
        focused={false}
        onReach={() => {
          // Nothing here clicks the window.
        }}
        onScreen={false}
        surfaceSize={undefined}
      />,
    );
    expect(portal(container)).not.toBeVisible();
  });

  it("gives the keyboard to the window the shell says is focused", () => {
    // Without a click: the user types into what they just opened, switched to,
    // or brought to the front. The shell names one window and the portal is
    // what carries that to the compositor.
    render(
      <AppWindow
        appId="term"
        clickThrough={false}
        cursor={undefined}
        dragging={false}
        floating={undefined}
        focused
        onReach={() => {
          // Nothing here clicks the window.
        }}
        onScreen
        surfaceSize={undefined}
      />,
    );
    expect(focused).toStrictEqual(["term"]);
  });

  it("scales the client's pointer by the size the shell holds for it", () => {
    // The client draws at its own resolution and the page lays the window out
    // at whatever fits, so a pointer at the middle of the box is at the middle
    // of the client's surface rather than at the same number of pixels in. The
    // element measures 100x100 here, so a client that drew at 200x400 is
    // twice as far across and four times as far down.
    const { container } = render(
      <AppWindow
        appId="term"
        clickThrough={false}
        cursor={undefined}
        dragging={false}
        floating={undefined}
        focused={false}
        onReach={() => {
          // Nothing here clicks the window.
        }}
        onScreen
        surfaceSize={[200, 400]}
      />,
    );

    portal(container).dispatchEvent(
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 10,
        clientY: 10,
      }),
    );

    expect(motions).toStrictEqual([[20, 40]]);
  });

  it("shows the cursor the client asked for", () => {
    const { container } = render(
      <AppWindow
        appId="term"
        clickThrough={false}
        cursor="text"
        dragging={false}
        floating={undefined}
        focused={false}
        onReach={() => {
          // Nothing here clicks the window.
        }}
        onScreen
        surfaceSize={undefined}
      />,
    );
    expect(portal(container)).toHaveStyle({ cursor: "text" });
  });
});
