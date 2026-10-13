import { describe, expect, it } from "bun:test";
import type { WebViewDialogType } from "@domicile-desktop/sdk/webview-element";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PageDialog } from "./PageDialog";
import type { DialogRequest } from "./useDialogRequest";

/** A dialog from example.com, recording its answers. */
const requestFor = (
  type: WebViewDialogType,
  answers: string[],
  origin = "https://example.com",
): DialogRequest => ({
  accept: (value) => {
    answers.push(`accept ${value ?? ""}`);
  },
  defaultValue: type === "prompt" ? "Ada" : "",
  dismiss: () => {
    answers.push("dismiss");
  },
  message: "Hello there",
  origin,
  type,
});

const button = (name: string): HTMLElement =>
  screen.getByRole("button", { name });

describe("PageDialog", () => {
  describe("rendering", () => {
    it("names the site and shows the page's message", () => {
      render(<PageDialog request={requestFor("alert", [])} />);

      const dialog = screen.getByRole("alertdialog", {
        name: "example.com says",
      });
      expect(dialog).toHaveAccessibleDescription("Hello there");
    });

    it("names the page for a frame with no site", () => {
      render(<PageDialog request={requestFor("alert", [], "null")} />);

      expect(
        screen.getByRole("alertdialog", { name: "This page says" }),
      ).toBeInTheDocument();
    });

    it("names the asker it is given", () => {
      render(
        <PageDialog asker="Bitwarden" request={requestFor("alert", [])} />,
      );

      expect(
        screen.getByRole("alertdialog", { name: "Bitwarden says" }),
      ).toBeInTheDocument();
    });

    it("gives an alert only OK", () => {
      render(<PageDialog request={requestFor("alert", [])} />);

      expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
        "OK",
      ]);
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("gives a prompt a field holding its initial text", () => {
      render(<PageDialog request={requestFor("prompt", [])} />);

      expect(screen.getByRole("textbox")).toHaveValue("Ada");
    });
  });

  // The caller focuses it, as its focus rules allow.
  describe("the element to focus", () => {
    it("is OK", async () => {
      const target = await new Promise<HTMLElement>((resolve) => {
        render(
          <PageDialog
            ref={(element) => {
              if (element !== null) {
                resolve(element);
              }
            }}
            request={requestFor("confirm", [])}
          />,
        );
      });

      expect(target).toBe(button("OK"));
    });

    it("is a prompt's field", async () => {
      const target = await new Promise<HTMLElement>((resolve) => {
        render(
          <PageDialog
            ref={(element) => {
              if (element !== null) {
                resolve(element);
              }
            }}
            request={requestFor("prompt", [])}
          />,
        );
      });

      expect(target).toBe(screen.getByRole("textbox"));
    });
  });

  describe("answers", () => {
    it("accepts on OK", async () => {
      const answers: string[] = [];
      render(<PageDialog request={requestFor("confirm", answers)} />);

      await userEvent.click(button("OK"));

      expect(answers).toStrictEqual(["accept "]);
    });

    it("dismisses on Cancel", async () => {
      const answers: string[] = [];
      render(<PageDialog request={requestFor("confirm", answers)} />);

      await userEvent.click(button("Cancel"));

      expect(answers).toStrictEqual(["dismiss"]);
    });

    it("dismisses on Escape", async () => {
      const answers: string[] = [];
      render(<PageDialog request={requestFor("confirm", answers)} />);

      button("OK").focus();
      await userEvent.keyboard("{Escape}");

      expect(answers).toStrictEqual(["dismiss"]);
    });

    it("gives a prompt's text on Enter", async () => {
      const answers: string[] = [];
      render(<PageDialog request={requestFor("prompt", answers)} />);

      await userEvent.clear(screen.getByRole("textbox"));
      await userEvent.type(screen.getByRole("textbox"), "Grace{Enter}");

      expect(answers).toStrictEqual(["accept Grace"]);
    });
  });
});
