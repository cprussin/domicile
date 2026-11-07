import { describe, expect, it } from "bun:test";
import type { WebViewPickerKind } from "@domicile-desktop/sdk/webview-element";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { matchingOptions, PickerAsk } from "./PickerAsk";
import type { PickerOption, PickerRequest } from "./usePickerRequest";

const TODAY = { day: 6, month: 11, year: 2026 };

/** A picker of `kind`, recording its answers. */
const pickerFor = (
  answers: string[],
  kind: WebViewPickerKind,
  {
    max = "",
    min = "",
    options = [] as readonly PickerOption[],
    step = "",
    value = "",
  } = {},
): PickerRequest => ({
  anchor: { height: 24, width: 120, x: 10, y: 40 },
  cancel: () => {
    answers.push("cancel");
  },
  choose: (picked) => {
    answers.push(`choose ${picked}`);
  },
  kind,
  max,
  min,
  options,
  step,
  value,
});

const open = (request: PickerRequest) =>
  render(<PickerAsk request={request} today={TODAY} />);

describe("PickerAsk", () => {
  it("hangs below its control", () => {
    open(pickerFor([], "date"));
    const card = screen.getByRole("dialog", { name: "Pick a date" });
    expect(card.style.insetInlineStart).toBe("10px");
    expect(card.style.insetBlockStart).toBe("68px");
  });

  it("keeps the old value on Escape", async () => {
    const answers: string[] = [];
    open(pickerFor(answers, "date", { value: "2026-11-06" }));
    screen.getByRole("button", { name: "November 6, 2026" }).focus();

    await userEvent.keyboard("{Escape}");

    expect(answers).toStrictEqual(["cancel"]);
  });

  it("keeps the old value on a press outside it", () => {
    const answers: string[] = [];
    const { container } = open(pickerFor(answers, "time"));

    fireEvent.pointerDown(container.firstElementChild as Element);

    expect(answers).toStrictEqual(["cancel"]);
  });

  describe("a date", () => {
    it("picks a day in the shown month", async () => {
      const answers: string[] = [];
      open(pickerFor(answers, "date", { value: "2026-11-06" }));

      expect(screen.getByRole("heading").textContent).toBe("November 2026");
      await userEvent.click(
        screen.getByRole("button", { name: "November 20, 2026" }),
      );

      expect(answers).toStrictEqual(["choose 2026-11-20"]);
    });

    it("turns the month and offers no day outside the limits", async () => {
      const answers: string[] = [];
      open(
        pickerFor(answers, "date", { max: "2026-12-10", value: "2026-11-06" }),
      );

      await userEvent.click(screen.getByRole("button", { name: "Next month" }));

      expect(screen.getByRole("heading").textContent).toBe("December 2026");
      expect(
        screen.getByRole("button", { name: "December 11, 2026" }),
      ).toHaveProperty("disabled", true);
    });

    it("picks today", async () => {
      const answers: string[] = [];
      open(pickerFor(answers, "date"));

      await userEvent.click(screen.getByRole("button", { name: "Today" }));

      expect(answers).toStrictEqual(["choose 2026-11-06"]);
    });

    it("walks days with the arrow keys and picks with Enter", async () => {
      const answers: string[] = [];
      open(pickerFor(answers, "date", { value: "2026-11-06" }));
      screen.getByRole("button", { name: "November 6, 2026" }).focus();

      await userEvent.keyboard("{ArrowDown}{ArrowRight}{Enter}");

      expect(answers).toStrictEqual(["choose 2026-11-14"]);
    });
  });

  it("picks a week as its ISO number", async () => {
    const answers: string[] = [];
    open(pickerFor(answers, "week", { value: "2026-W45" }));

    await userEvent.click(
      screen.getByRole("button", { name: "November 12, 2026" }),
    );

    expect(answers).toStrictEqual(["choose 2026-W46"]);
  });

  it("picks a month", async () => {
    const answers: string[] = [];
    open(pickerFor(answers, "month", { value: "2026-11" }));

    await userEvent.click(screen.getByRole("button", { name: "Next year" }));
    await userEvent.click(screen.getByRole("button", { name: "Mar" }));

    expect(answers).toStrictEqual(["choose 2027-03"]);
  });

  it("picks a time in the input's steps", async () => {
    const answers: string[] = [];
    open(pickerFor(answers, "time", { step: "900", value: "09:00" }));

    expect(
      screen
        .getAllByRole("option")
        .filter((option) => option.closest("[aria-label=Minute]"))
        .map((option) => option.textContent),
    ).toStrictEqual(["00", "15", "30", "45"]);
    await userEvent.click(screen.getByRole("option", { name: "14" }));
    await userEvent.click(screen.getByRole("option", { name: "30" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(answers).toStrictEqual(["choose 14:30"]);
  });

  it("picks a date and a time together", async () => {
    const answers: string[] = [];
    open(pickerFor(answers, "datetime-local", { value: "2026-11-06T08:00" }));

    await userEvent.click(
      screen.getByRole("button", { name: "November 7, 2026" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(answers).toStrictEqual(["choose 2026-11-07T08:00"]);
  });

  describe("a color", () => {
    it("takes a typed hex color", async () => {
      const answers: string[] = [];
      open(pickerFor(answers, "color", { value: "#000000" }));

      const hex = screen.getByLabelText("Hex");
      await userEvent.clear(hex);
      await userEvent.type(hex, "1971C2{Enter}");

      expect(answers).toStrictEqual(["choose #1971c2"]);
    });

    it("offers the page's suggested colors", async () => {
      const answers: string[] = [];
      open(
        pickerFor(answers, "color", {
          options: [{ label: "Brand blue", value: "#1971c2" }],
          value: "#000000",
        }),
      );

      await userEvent.click(screen.getByRole("button", { name: "Brand blue" }));

      expect(answers).toStrictEqual(["choose #1971c2"]);
    });
  });

  describe("a list", () => {
    const options = [
      { label: "", value: "Blink" },
      { label: "Firefox's engine", value: "Gecko" },
      { label: "", value: "WebKit" },
    ];

    it("narrows to what was typed", () => {
      expect(
        matchingOptions(pickerFor([], "list", { options, value: "IT" })).map(
          (option) => option.value,
        ),
      ).toStrictEqual(["WebKit"]);
      expect(
        matchingOptions(pickerFor([], "list", { options, value: "zz" })),
      ).toHaveLength(3);
    });

    it("picks an option", async () => {
      const answers: string[] = [];
      open(pickerFor(answers, "list", { options, value: "fire" }));

      await userEvent.click(screen.getByRole("option", { name: /Gecko/ }));

      expect(answers).toStrictEqual(["choose Gecko"]);
    });
  });
});
