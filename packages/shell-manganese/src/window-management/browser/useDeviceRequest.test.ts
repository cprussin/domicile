import { describe, expect, it } from "bun:test";
import {
  WEBVIEW_DEVICE_REQUEST_CHANGE_EVENT,
  WEBVIEW_DEVICE_REQUEST_EVENT,
  WEBVIEW_DEVICE_REQUEST_WITHDRAWN_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { act, renderHook } from "@testing-library/react";

import { useDeviceRequest } from "./useDeviceRequest";

type Asked = {
  event: DomicileDeviceRequestEvent;
  /** Replaces the devices on offer, as the engine does before a change. */
  offer: (devices: readonly DomicileDevice[]) => void;
};

/**
 * A fake engine device request, recording its answers. Built by hand because
 * the test DOM lacks the engine's event type; cancelable because claiming it
 * is `preventDefault()`. Starts unlisted, as the engine's does.
 */
const asks = (view: HTMLElement, answers: string[]): Asked => {
  const state: { devices: readonly DomicileDevice[]; listed: boolean } = {
    devices: [],
    listed: false,
  };
  const event = Object.assign(
    new Event(WEBVIEW_DEVICE_REQUEST_EVENT, { cancelable: true }),
    {
      cancel: () => {
        answers.push("cancel");
      },
      choose: (ids: readonly number[]) => {
        answers.push(`choose ${ids.join(",")}`);
      },
      devices: () => state.devices,
      listed: false,
      multiple: false,
      title: "wallet.example wants to connect to a HID device",
    },
  );
  // A getter, which `Object.assign` would have read once.
  Object.defineProperty(event, "listed", { get: () => state.listed });
  act(() => {
    view.dispatchEvent(event);
  });
  return {
    event,
    offer: (devices) => {
      state.devices = devices;
      state.listed = true;
      act(() => {
        view.dispatchEvent(new Event(WEBVIEW_DEVICE_REQUEST_CHANGE_EVENT));
      });
    },
  };
};

describe("useDeviceRequest", () => {
  // The engine cancels unclaimed requests when dispatch returns.
  it("takes the page's request, with no devices known yet", () => {
    const view = document.createElement("webview");
    const { result } = renderHook(() => useDeviceRequest(view));

    const { event } = asks(view, []);

    expect(event.defaultPrevented).toBe(true);
    expect(result.current?.title).toBe(
      "wallet.example wants to connect to a HID device",
    );
    expect(result.current?.devices).toBeUndefined();
  });

  it("follows the devices on offer", () => {
    const view = document.createElement("webview");
    const { result } = renderHook(() => useDeviceRequest(view));
    const { offer } = asks(view, []);

    offer([{ id: 1, name: "Nano X" }]);

    expect(result.current?.devices).toStrictEqual([{ id: 1, name: "Nano X" }]);
  });

  it("chooses one device, and has no request left", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => useDeviceRequest(view));
    asks(view, answers).offer([{ id: 1, name: "Nano X" }]);

    act(() => {
      result.current?.choose(1);
    });

    expect(answers).toStrictEqual(["choose 1"]);
    expect(result.current).toBeUndefined();
  });

  it("cancels, and has no request left", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => useDeviceRequest(view));
    asks(view, answers);

    act(() => {
      result.current?.cancel();
    });

    expect(answers).toStrictEqual(["cancel"]);
    expect(result.current).toBeUndefined();
  });

  it("drops a request the browser withdrew", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { result } = renderHook(() => useDeviceRequest(view));
    asks(view, answers);

    act(() => {
      view.dispatchEvent(new Event(WEBVIEW_DEVICE_REQUEST_WITHDRAWN_EVENT));
    });

    expect(result.current).toBeUndefined();
    expect(answers).toStrictEqual([]);
  });

  // Unmounting draws no chooser, so the page would otherwise wait for one.
  it("cancels an open request when unmounted", () => {
    const view = document.createElement("webview");
    const answers: string[] = [];
    const { unmount } = renderHook(() => useDeviceRequest(view));
    asks(view, answers);

    unmount();

    expect(answers).toStrictEqual(["cancel"]);
  });
});
