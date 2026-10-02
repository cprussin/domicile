import { describe, expect, it } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "../Button/Button";
import { DisplayProvider } from "../Screen/DisplayProvider";

import { SlideOver } from "./SlideOver";

describe(SlideOver, () => {
  it("does not render the body when closed", () => {
    render(
      <SlideOver open={false} title="Transcript">
        Body
      </SlideOver>,
    );
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
  });

  it("renders the title, body, and close button when open", () => {
    render(
      <SlideOver open title="Transcript">
        Body
      </SlideOver>,
    );
    expect(screen.getByText("Transcript")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("slides in over the screen it is asked for", () => {
    render(
      <DisplayProvider
        source={{
          displays: [
            { name: "left", position: [0, 0], scale: 1, size: [1920, 1080] },
            {
              name: "right",
              position: [1920, 0],
              scale: 1,
              size: [1920, 1080],
            },
          ],
          onDisplays: () => () => undefined,
        }}
      >
        <SlideOver open screen="left" title="Transcript">
          Body
        </SlideOver>
      </DisplayProvider>,
    );
    const viewport = screen.getByRole("dialog").parentElement;
    expect(viewport?.style.left).toBe("0px");
    expect(viewport?.style.width).toBe("1920px");
  });

  it("renders the trigger and keeps the panel closed until clicked", async () => {
    render(
      <SlideOver title="Transcript" trigger={<Button>Open</Button>}>
        Body
      </SlideOver>,
    );
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Body")).toBeInTheDocument();
  });

  it("closes when the close button is clicked", async () => {
    render(
      <SlideOver defaultOpen title="Transcript">
        Body
      </SlideOver>,
    );
    expect(screen.getByText("Body")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByText("Body")).not.toBeInTheDocument();
    });
  });
});
