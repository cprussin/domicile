import { describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo } from "react";

import { Button } from "../Button/Button";

import { createHandle, ModalDialog } from "./ModalDialog";

describe(ModalDialog, () => {
  describe("rendering", () => {
    it("does not render the body when closed", () => {
      render(
        <ModalDialog open={false} title="Settings">
          Body
        </ModalDialog>,
      );
      expect(screen.queryByText("Body")).not.toBeInTheDocument();
    });

    it("renders the title, body, and close button when open", () => {
      render(
        <ModalDialog open title="Settings">
          Body
        </ModalDialog>,
      );
      expect(screen.getByText("Settings")).toBeInTheDocument();
      expect(screen.getByText("Body")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });

    it("renders the close button even when no title is provided", () => {
      render(<ModalDialog open>Body</ModalDialog>);
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
      expect(screen.getByText("Body")).toBeInTheDocument();
    });

    it("renders the footer when provided", () => {
      render(
        <ModalDialog footer={<Button variant="solid">Save</Button>} open>
          Body
        </ModalDialog>,
      );
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    });

    it("renders no footer-area buttons when no footer is provided", () => {
      render(<ModalDialog open>Body</ModalDialog>);
      expect(screen.getAllByRole("button")).toHaveLength(1);
    });

    it("renders the trigger when provided and keeps the dialog closed", () => {
      render(
        <ModalDialog trigger={<Button>Open me</Button>}>Body</ModalDialog>,
      );
      expect(
        screen.getByRole("button", { name: "Open me" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Body")).not.toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("opens when the trigger is clicked", async () => {
      const user = userEvent.setup();
      render(
        <ModalDialog trigger={<Button>Open me</Button>}>Body</ModalDialog>,
      );
      await user.click(screen.getByRole("button", { name: "Open me" }));
      expect(await screen.findByText("Body")).toBeInTheDocument();
    });

    it("invokes onOpenChange with false when the corner close button is clicked", async () => {
      const user = userEvent.setup();
      const onOpenChange = mock();
      render(
        <ModalDialog onOpenChange={onOpenChange} open title="Settings">
          Body
        </ModalDialog>,
      );
      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(onOpenChange).toHaveBeenCalled();
      expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
    });

    it("closes via ModalDialog.CloseButton in the footer", async () => {
      const user = userEvent.setup();
      const onOpenChange = mock();
      render(
        <ModalDialog
          footer={
            <ModalDialog.CloseButton variant="ghost">
              Dismiss
            </ModalDialog.CloseButton>
          }
          onOpenChange={onOpenChange}
          open
        >
          Body
        </ModalDialog>,
      );
      await user.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(onOpenChange).toHaveBeenCalled();
      expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
    });

    it("closes via ModalDialog.Close render prop in the footer", async () => {
      const user = userEvent.setup();
      const onOpenChange = mock();
      render(
        <ModalDialog
          footer={
            <ModalDialog.Close render={<button type="button">Custom</button>} />
          }
          onOpenChange={onOpenChange}
          open
        >
          Body
        </ModalDialog>,
      );
      await user.click(screen.getByRole("button", { name: "Custom" }));
      expect(onOpenChange).toHaveBeenCalled();
      expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
    });
  });

  describe("createHandle", () => {
    const HandleHarness = () => {
      const handle = useMemo(() => createHandle(), []);
      return (
        <>
          <button
            onClick={() => {
              handle.open(null);
            }}
            type="button"
          >
            External Open
          </button>
          <button
            onClick={() => {
              handle.close();
            }}
            type="button"
          >
            External Close
          </button>
          <ModalDialog handle={handle}>Body</ModalDialog>
        </>
      );
    };

    it("opens the dialog via handle.open()", async () => {
      const user = userEvent.setup();
      render(<HandleHarness />);
      expect(screen.queryByText("Body")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "External Open" }));
      expect(await screen.findByText("Body")).toBeInTheDocument();
    });

    it("closes the dialog via handle.close()", async () => {
      const user = userEvent.setup();
      render(<HandleHarness />);
      await user.click(screen.getByRole("button", { name: "External Open" }));
      expect(await screen.findByText("Body")).toBeInTheDocument();
      // `hidden: true` because the open modal applies `aria-hidden` to
      // outside content (base-ui's focus trap); the External Close button
      // is therefore outside the accessible tree by default.
      await user.click(
        screen.getByRole("button", { hidden: true, name: "External Close" }),
      );
      await waitFor(() => {
        expect(screen.queryByText("Body")).not.toBeInTheDocument();
      });
    });
  });
});
