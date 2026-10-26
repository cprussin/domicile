import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, render, screen } from "@testing-library/react";

import { FakeDomicile } from "./fake-domicile";
import { perDesktop } from "./per-desktop";
import { sharedWatch } from "./shared-watch";
import { useDeskWatch, useSharedWatch } from "./use-shared-watch";

describe("useSharedWatch", () => {
  it("is undefined before the first value, then each value", () => {
    const senders: ((value: string) => void)[] = [];
    const watch = sharedWatch((onValue: (value: string) => void) => {
      senders.push(onValue);
      return () => undefined;
    });
    const Shows = () => <span>{useSharedWatch(watch) ?? "waiting"}</span>;
    render(<Shows />);
    expect(screen.getByText("waiting")).toBeInTheDocument();

    act(() => {
      senders[0]?.("ready");
    });

    expect(screen.getByText("ready")).toBeInTheDocument();
  });
});

describe("useDeskWatch", () => {
  it("reads the one watch of the desktop above, shared by every caller", () => {
    const fake = new FakeDomicileHost();
    const made: unknown[] = [];
    const senders: ((value: string) => void)[] = [];
    const desk = perDesktop((domicile) => {
      made.push(domicile);
      return sharedWatch((onValue: (value: string) => void) => {
        senders.push(onValue);
        return () => undefined;
      });
    });
    const Shows = () => <span>{useDeskWatch(desk) ?? "waiting"}</span>;
    render(
      <FakeDomicile fake={fake}>
        <Shows />
        <Shows />
      </FakeDomicile>,
    );

    act(() => {
      senders[0]?.("ready");
    });

    expect(made).toEqual([fake.domicile]);
    expect(senders).toHaveLength(1);
    expect(screen.getAllByText("ready")).toHaveLength(2);
  });
});
