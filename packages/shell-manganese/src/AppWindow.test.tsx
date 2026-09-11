import { beforeEach, describe, expect, it } from "bun:test";
import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import type { Measure } from "@domicile/chrome-sdk/measure";
import {
  APP_TAG_NAME,
  registerElements,
} from "@domicile/chrome-sdk/register-elements";
import { render } from "@testing-library/react";
import { AppWindow } from "./AppWindow";
import { AppElements } from "./app-elements";

// The elements report their size to a bridge as they mount, and ask it for the
// keyboard when they are clicked. Only the second is read here — whether the
// keyboard moved, and on whose say-so.
let focused: string[] = [];

const recordingBridge = {
  focusApp: (appId: string) => {
    focused.push(appId);
  },
  focusChrome: () => undefined,
  resizeApp: () => undefined,
} as unknown as BridgeClient;

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
  registerElements(recordingBridge, {
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
        appElements={new AppElements()}
        appId="term"
        clickThrough={false}
        dragging={false}
        floating={undefined}
        focused
        onReach={() => {
          // Nothing here clicks the window.
        }}
        onScreen
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
        appElements={new AppElements()}
        appId="term"
        clickThrough={false}
        dragging={false}
        floating={undefined}
        focused={false}
        onReach={() => {
          reached.push("term");
        }}
        onScreen
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
        appElements={new AppElements()}
        appId="term"
        clickThrough={false}
        dragging={false}
        floating={undefined}
        focused
        onReach={() => {
          reached.push("term");
        }}
        onScreen
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
        appElements={new AppElements()}
        appId="term"
        clickThrough={false}
        dragging={false}
        floating={undefined}
        focused={false}
        onReach={() => {
          // Nothing here clicks the window.
        }}
        onScreen={false}
      />,
    );
    expect(portal(container)).not.toBeVisible();
  });
});
