import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, render, screen } from "@testing-library/react";

import { useWatch } from "./use-watch";

const Focused = ({ fake }: { fake: FakeDomicileHost }) => {
  const { windows } = fake.domicile;
  return (
    <span>
      {useWatch(windows, "focuschange", () => windows.focused) ?? "none"}
    </span>
  );
};

/** A source the test drives, counting who listens. */
const counted = () => {
  const listening = new Set<() => void>();
  const counts = { added: 0, removed: 0 };
  return {
    counts,
    source: {
      on: (_type: "change", listener: () => void) => {
        counts.added += 1;
        listening.add(listener);
        return () => {
          counts.removed += 1;
          listening.delete(listener);
        };
      },
    },
  };
};

const Counted = ({
  source,
}: {
  source: ReturnType<typeof counted>["source"];
}) => <span>{useWatch(source, "change", () => "read")}</span>;

describe("useWatch", () => {
  it("is what `read` says now", () => {
    const fake = new FakeDomicileHost();
    fake.set({ focusedWindow: "term" });

    render(<Focused fake={fake} />);

    expect(screen.getByText("term")).toBeInTheDocument();
  });

  it("reads again on each event", () => {
    const fake = new FakeDomicileHost();
    render(<Focused fake={fake} />);

    act(() => {
      fake.set({ focusedWindow: "browser" });
    });

    expect(screen.getByText("browser")).toBeInTheDocument();
  });

  it("listens once across renders, and stops on unmount", () => {
    const { counts, source } = counted();
    const { rerender, unmount } = render(<Counted source={source} />);

    rerender(<Counted source={source} />);
    expect(counts).toEqual({ added: 1, removed: 0 });

    unmount();
    expect(counts).toEqual({ added: 1, removed: 1 });
  });
});
