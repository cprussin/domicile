import { afterEach, describe, expect, it } from "bun:test";
import {
  act,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "../Button/Button";
import { Select } from "../Select/Select";

import { Popover, PopoverContainer } from "./Popover";

describe(Popover, () => {
  describe("rendering", () => {
    it("does not render the body when closed", () => {
      render(
        <Popover open={false} title="Connection">
          Body
        </Popover>,
      );
      expect(screen.queryByText("Body")).not.toBeInTheDocument();
    });

    it("renders the title and the body when open", () => {
      render(
        <Popover open title="Connection">
          Body
        </Popover>,
      );
      expect(screen.getByText("Connection")).toBeInTheDocument();
      expect(screen.getByText("Body")).toBeInTheDocument();
    });

    it("renders a body with no title", () => {
      render(
        <Popover open title={undefined}>
          Body
        </Popover>,
      );
      expect(screen.getByText("Body")).toBeInTheDocument();
    });

    it("says when it is drawn flush, so the stylesheet can drop its padding", () => {
      render(
        <Popover flush open>
          Body
        </Popover>,
      );
      expect(screen.getByRole("dialog")).toHaveAttribute("data-flush");
    });

    it("says when it is wide, so the stylesheet can widen its cap", () => {
      render(
        <Popover open wide>
          Body
        </Popover>,
      );
      expect(screen.getByRole("dialog")).toHaveAttribute("data-wide");
    });

    it("says when it is drawn over a photograph, so the stylesheet can glass it", () => {
      render(
        <Popover open tone="overPhoto">
          Body
        </Popover>,
      );
      expect(screen.getByRole("dialog")).toHaveAttribute(
        "data-tone",
        "overPhoto",
      );
    });

    it("is padded unless it is drawn flush", () => {
      render(<Popover open>Body</Popover>);
      expect(screen.getByRole("dialog")).not.toHaveAttribute("data-flush");
    });

    it("renders the trigger and stays closed until it is pressed", () => {
      render(
        <Popover title="Connection" trigger={<Button>Details</Button>}>
          Body
        </Popover>,
      );
      expect(screen.getByRole("button", { name: "Details" })).toBeVisible();
      expect(screen.queryByText("Body")).not.toBeInTheDocument();
    });

    it("draws the panel in the element a PopoverContainer names", () => {
      const layer = document.createElement("div");
      document.body.append(layer);
      render(
        <PopoverContainer value={layer}>
          <Popover open>Body</Popover>
        </PopoverContainer>,
      );
      expect(layer).toContainElement(screen.getByRole("dialog"));
      layer.remove();
    });
  });

  describe("interactions", () => {
    it("opens when its trigger is pressed", async () => {
      render(
        <Popover title="Connection" trigger={<Button>Details</Button>}>
          Body
        </Popover>,
      );

      await userEvent.click(screen.getByRole("button", { name: "Details" }));

      expect(screen.getByText("Body")).toBeInTheDocument();
    });

    describe("on a desktop of several screens", () => {
      afterEach(undrawPanels);

      it("stays on its trigger's screen", async () => {
        render(
          <div data-screen="DP-1">
            <Popover trigger={<Button>Details</Button>}>Body</Popover>
          </div>,
        );
        const trigger = screen.getByRole("button", { name: "Details" });
        drawAt(trigger, { height: 28, width: 28, x: 560, y: 0 });
        drawAt(trigger.parentElement as HTMLElement, {
          height: 800,
          width: 600,
          x: 0,
          y: 0,
        });
        drawPanels({ height: 100, width: 300 });

        await userEvent.click(trigger);

        await waitFor(() => {
          expect(panelRight()).toBeLessThanOrEqual(600);
        });
      });
    });

    it("closes when focus moves to something outside it", async () => {
      render(
        <>
          <Popover title="Connection" trigger={<Button>Details</Button>}>
            Body
          </Popover>
          <button type="button">Elsewhere</button>
        </>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Details" }));

      act(() => {
        screen.getByRole("button", { name: "Elsewhere" }).focus();
      });

      await waitForElementToBeRemoved(() => screen.queryByText("Body"));
    });

    it("stays open when focus moves within it", async () => {
      render(
        <Popover title="Connection" trigger={<Button>Details</Button>}>
          <button type="button">Inside</button>
        </Popover>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Details" }));

      act(() => {
        screen.getByRole("button", { name: "Inside" }).focus();
      });

      expect(screen.getByRole("button", { name: "Inside" })).toBeVisible();
    });

    it("stays open while a select inside it is used, though its list is drawn elsewhere", async () => {
      const user = userEvent.setup();
      render(
        <Popover title="Connection" trigger={<Button>Details</Button>}>
          <Select
            aria-label="Port"
            defaultValue="speakers"
            options={[
              { label: "Speakers", value: "speakers" },
              { label: "Headphones", value: "headphones" },
            ]}
          />
        </Popover>,
      );
      await user.click(screen.getByRole("button", { name: "Details" }));

      await user.click(screen.getByRole("combobox", { name: "Port" }));
      await user.click(screen.getByRole("option", { name: "Headphones" }));

      expect(screen.getByRole("combobox", { name: "Port" })).toHaveTextContent(
        "Headphones",
      );
    });
  });
});

/** Lays `element` out at `rect`, as a browser would. */
const drawAt = (
  element: HTMLElement,
  rect: { height: number; width: number; x: number; y: number },
) => {
  element.getBoundingClientRect = () => DOMRect.fromRect(rect);
};

const unpatched = Object.getOwnPropertyDescriptors(HTMLElement.prototype);
// Defined on `Element`, so the override on `HTMLElement` shadows it.
const elementRect = Element.prototype.getBoundingClientRect;

/**
 * Lays every panel out at `size` in a 1920px-wide page, wider than the
 * trigger's screen. The positioner measures the element around the dialog.
 */
const drawPanels = (size: { height: number; width: number }) => {
  const isPanel = (element: HTMLElement) =>
    element.querySelector(":scope > [role=dialog]") !== null;
  Object.defineProperties(document.documentElement, {
    clientHeight: { configurable: true, value: 1080 },
    clientWidth: { configurable: true, value: 1920 },
  });
  Object.defineProperties(HTMLElement.prototype, {
    getBoundingClientRect: {
      configurable: true,
      value(this: HTMLElement) {
        return isPanel(this)
          ? DOMRect.fromRect({ ...size, x: 0, y: 0 })
          : elementRect.call(this);
      },
    },
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return isPanel(this) ? size.height : 0;
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return isPanel(this) ? size.width : 0;
      },
    },
  });
};

const undrawPanels = () => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).getBoundingClientRect;
  Object.defineProperties(HTMLElement.prototype, unpatched);
  Reflect.deleteProperty(document.documentElement, "clientHeight");
  Reflect.deleteProperty(document.documentElement, "clientWidth");
};

/** The open panel's right edge, from the positioner's transform. */
const panelRight = () => {
  const transform =
    screen.getByRole("dialog").parentElement?.style.transform ?? "";
  const x = /translate\((-?[\d.]+)px/.exec(transform)?.[1];
  if (x === undefined) {
    throw new Error(`the panel is not placed: "${transform}"`);
  } else {
    return Number(x) + 300;
  }
};
