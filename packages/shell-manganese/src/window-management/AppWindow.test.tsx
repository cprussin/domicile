import { beforeEach, describe, expect, it } from "bun:test";
import { APP_TAG_NAME } from "@domicile/chrome-sdk/app-element";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { Measure } from "@domicile/chrome-sdk/measure";
import { registerElements } from "@domicile/chrome-sdk/register-elements";
import { render } from "@testing-library/react";

import { AppWindow } from "./AppWindow";

// The SDK reports each window's size to a client, asks it for the keyboard when
// a window is clicked, and forwards the pointer over one in the client's own
// coordinates. What is read here is only the keyboard: whether it moved, and on
// whose say-so. The pointer mapping is the SDK's own and is tested there.
let focused: string[] = [];

const recordingDomicile = {
  focusApp: (appId: string) => {
    focused.push(appId);
  },
  focusChrome: () => undefined,
  // Recorded only so a click does not throw out of the SDK's own handler: the
  // button belongs to the client, and nothing here asserts on it.
  pointerButton: () => undefined,
  pointerMotion: () => undefined,
  resizeApp: () => undefined,
  surfaceSizeOf: () => undefined,
} as unknown as DomicileClient;

// The test DOM performs no layout, so measurement is injected.
const stubMeasure: Measure = () => ({
  size: [100, 100],
  transform: [1, 0, 0, 1, 0, 0],
  visible: true,
});

/** The props every case here shares; each overrides the one it is about. */
const windowProps = {
  appId: "term",
  clickThrough: false,
  cursor: undefined,
  domicile: recordingDomicile,
  dragging: false,
  floating: undefined,
  onScreen: true,
} as const;

const noReach = () => {
  // Nothing in the case reaches for the window.
};

const portal = (container: HTMLElement): Element => {
  const element = container.querySelector(APP_TAG_NAME);
  if (element === null) {
    throw new Error("test: the app window rendered no element");
  } else {
    return element;
  }
};

beforeEach(() => {
  focused = [];
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
  it("mounts an element carrying the host's app id", () => {
    const { container } = render(
      <AppWindow {...windowProps} focused onReach={noReach} />,
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
        {...windowProps}
        focused={false}
        onReach={() => {
          reached.push("term");
        }}
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
        {...windowProps}
        focused
        onReach={() => {
          reached.push("term");
        }}
      />,
    );

    portal(container).dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );

    expect(reached).toStrictEqual([]);
  });

  it("hides the element when the window is not on the stage", () => {
    const { container } = render(
      <AppWindow
        {...windowProps}
        focused={false}
        onReach={noReach}
        onScreen={false}
      />,
    );
    expect(portal(container)).not.toBeVisible();
  });

  it("gives the keyboard to the window the shell says is focused", () => {
    // Without a click: the user types into what they just opened, switched to,
    // or brought to the front. The shell names one window and this is what
    // carries that to the compositor — and to the SDK, which is what routes the
    // keystrokes that follow.
    render(<AppWindow {...windowProps} focused onReach={noReach} />);
    expect(focused).toStrictEqual(["term"]);
  });

  it("does not ask for the keyboard for a window the shell has not named", () => {
    // Only that way round: "this window has it" is an instruction the compositor
    // can carry out and "this window does not" is not one, so an unfocused
    // window says nothing rather than handing the keyboard back.
    render(<AppWindow {...windowProps} focused={false} onReach={noReach} />);
    expect(focused).toStrictEqual([]);
  });

  it("shows the cursor the client asked for", () => {
    // Ordinary CSS on an element this shell owns, which is what a cursor always
    // was — the SDK used to write it only because it owned the element class.
    const { container } = render(
      <AppWindow
        {...windowProps}
        cursor="text"
        focused={false}
        onReach={noReach}
      />,
    );
    expect(portal(container)).toHaveStyle({ cursor: "text" });
  });
});
