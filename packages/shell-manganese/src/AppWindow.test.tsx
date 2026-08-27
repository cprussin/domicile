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

// The elements report their box to a bridge as they mount; nothing here reads
// what they say, so a recorder that answers every call is enough.
const silentBridge = {
  focusApp: () => undefined,
  focusChrome: () => undefined,
  placePortal: () => undefined,
  removePortal: () => undefined,
  resizeApp: () => undefined,
} as unknown as BridgeClient;

// The test DOM performs no layout, so measurement is injected.
const stubMeasure: Measure = () => ({
  cornerRadius: 0,
  native: true,
  opacity: 1,
  shadow: undefined,
  size: [100, 100],
  takesPointer: true,
  transform: [1, 0, 0, 1, 0, 0],
  visible: true,
  zIndex: 0,
});

const pixels = new Uint8Array([0, 0, 0, 255]);

const portal = (container: HTMLElement): Element => {
  const element = container.querySelector(APP_TAG_NAME);
  if (element === null) {
    throw new Error("test: the app window rendered no portal");
  } else {
    return element;
  }
};

beforeEach(() => {
  registerElements(silentBridge, {
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
        onScreen
      />,
    );
    expect(portal(container).getAttribute("app-id")).toBe("term");
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
        onScreen={false}
      />,
    );
    expect(portal(container)).not.toBeVisible();
  });

  describe("frame routing", () => {
    it("registers the mounted portal so the host's frames reach it", () => {
      const appElements = new AppElements();
      const { container } = render(
        <AppWindow
          appElements={appElements}
          appId="term"
          clickThrough={false}
          dragging={false}
          floating={undefined}
          focused
          onScreen
        />,
      );
      appElements.drawFrame({
        app_id: "term",
        height: 1,
        pixels,
        scale: 1,
        width: 1,
      });
      expect(portal(container).querySelector("canvas")).not.toBeNull();
    });

    it("unregisters the portal when the window unmounts", () => {
      const appElements = new AppElements();
      const { unmount } = render(
        <AppWindow
          appElements={appElements}
          appId="term"
          clickThrough={false}
          dragging={false}
          floating={undefined}
          focused
          onScreen
        />,
      );
      unmount();
      appElements.drawFrame({
        app_id: "term",
        height: 1,
        pixels,
        scale: 1,
        width: 1,
      });
      expect(appElements.drawTiming.take()).toBeUndefined();
    });
  });
});
