import { afterEach, describe, expect, it, jest } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { PagePopup } from "./PagePopup";

/** A popup shown for `cue`, recording the cues it asks to close. */
const popup = (cue: number, closed: number[]) => (
  <PagePopup
    anchor={null}
    closesAfter={2000}
    cue={cue}
    onClose={(shown) => {
      closed.push(shown);
    }}
    open
  >
    <span>Body</span>
  </PagePopup>
);

const wait = (ms: number) => {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
};

describe(PagePopup, () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("asks to close what it showed once it has been up long enough", () => {
    jest.useFakeTimers();
    const closed: number[] = [];
    render(popup(1, closed));
    wait(1999);
    expect(closed).toStrictEqual([]);
    wait(1);
    expect(closed).toStrictEqual([1]);
  });

  it("waits again from each new thing it shows", () => {
    jest.useFakeTimers();
    const closed: number[] = [];
    const { rerender } = render(popup(1, closed));
    wait(1500);
    rerender(popup(2, closed));
    wait(1999);
    expect(closed).toStrictEqual([]);
    wait(1);
    expect(closed).toStrictEqual([2]);
  });

  it("stays while the pointer is on it, and waits again once it leaves", () => {
    jest.useFakeTimers();
    const closed: number[] = [];
    render(popup(1, closed));
    fireEvent.pointerEnter(screen.getByText("Body"));
    wait(10_000);
    expect(closed).toStrictEqual([]);
    fireEvent.pointerLeave(screen.getByText("Body"));
    wait(2000);
    expect(closed).toStrictEqual([1]);
  });

  it("leaves the keyboard in the page when it opens", async () => {
    const { rerender } = render(<input aria-label="Page" />);
    screen.getByRole("textbox", { name: "Page" }).focus();
    rerender(
      <>
        <input aria-label="Page" />
        {popup(1, [])}
      </>,
    );
    await screen.findByText("Body");
    expect(screen.getByRole("textbox", { name: "Page" })).toHaveFocus();
  });
});
