import { describe, expect, it } from "bun:test";

import type { DisplayView } from "./device-pixel-ratio";
import { reportDevicePixelRatio } from "./device-pixel-ratio";

/** A page whose density the test moves, and who is listening for the change. */
const pageAt = (ratio: number) => {
  const armed: { listener: () => void; query: string }[] = [];
  const view: DisplayView & { devicePixelRatio: number } = {
    devicePixelRatio: ratio,
    matchMedia: (query: string) => ({
      addEventListener: (
        _type: "change",
        listener: () => void,
        _options: { once: true },
      ) => {
        armed.push({ listener, query });
      },
    }),
  };
  return {
    armed,
    /** What the page would do when the display or the zoom changed. */
    moveTo: (next: number) => {
      view.devicePixelRatio = next;
      const last = armed.at(-1);
      if (last === undefined) {
        throw new Error("test: nothing was listening for the change");
      } else {
        last.listener();
      }
    },
    view,
  };
};

const reportsTo = (reported: number[]) => ({
  setDevicePixelRatio: (ratio: number) => {
    reported.push(ratio);
  },
});

describe("reportDevicePixelRatio", () => {
  it("tells the host what the page is drawing at", () => {
    const reported: number[] = [];
    reportDevicePixelRatio(reportsTo(reported), pageAt(2).view);
    expect(reported).toStrictEqual([2]);
  });

  it("tells it again when the display or the zoom changes", () => {
    // A client can only draw at the display's real resolution if the
    // compositor is told what that is, and the page is the only part of
    // Domicile that can see it change — moving to another display, or a zoom.
    const reported: number[] = [];
    const page = pageAt(2);
    reportDevicePixelRatio(reportsTo(reported), page.view);
    page.moveTo(1.5);
    expect(reported).toStrictEqual([2, 1.5]);
  });

  it("re-arms against the density it just reported", () => {
    // The query matches at exactly the current ratio, so it fires on any
    // change — which means each one has to be replaced with a query for the
    // new one, or the second change is never heard.
    const page = pageAt(2);
    reportDevicePixelRatio(reportsTo([]), page.view);
    page.moveTo(1.5);
    expect(page.armed.map(({ query }) => query)).toStrictEqual([
      "(resolution: 2dppx)",
      "(resolution: 1.5dppx)",
    ]);
  });
});
