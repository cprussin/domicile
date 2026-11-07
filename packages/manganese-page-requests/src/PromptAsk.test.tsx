import { describe, expect, it } from "bun:test";
import type { WebViewPromptKind } from "@domicile-desktop/sdk/webview-element";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PromptAsk } from "./PromptAsk";
import type { PromptRequest } from "./usePromptRequest";

/** A request of `kind`, recording its answers. */
const requestFor = (
  answers: string[],
  kind: WebViewPromptKind,
  {
    details = [] as readonly string[],
    origin = "https://vscode.dev",
    pin = "",
    subject = "",
  } = {},
): PromptRequest => ({
  accept: (choice = 0, text = "") => {
    answers.push(`accept ${choice} ${text}`);
  },
  details,
  dismiss: () => {
    answers.push("dismiss");
  },
  kind,
  origin,
  pin,
  subject,
});

const ask = (request: PromptRequest) => render(<PromptAsk request={request} />);

describe("PromptAsk", () => {
  describe("file access", () => {
    it("asks to let the site edit the file, showing its path", () => {
      ask(
        requestFor([], "file-edit", {
          details: ["/home/ada/notes.md"],
          subject: "notes.md",
        }),
      );

      const dialog = screen.getByRole("alertdialog", {
        name: "Let vscode.dev edit notes.md?",
      });
      expect(within(dialog).getByText("/home/ada/notes.md")).toBeTruthy();
    });

    it("allows it", async () => {
      const answers: string[] = [];
      ask(requestFor(answers, "file-view", { subject: "Photos" }));

      await userEvent.click(screen.getByRole("button", { name: "Allow" }));

      expect(answers).toStrictEqual(["accept 0 "]);
    });

    it("refuses it", async () => {
      const answers: string[] = [];
      ask(requestFor(answers, "file-view", { subject: "Photos" }));

      await userEvent.click(
        screen.getByRole("button", { name: "Don't allow" }),
      );

      expect(answers).toStrictEqual(["dismiss"]);
    });
  });

  describe("a client certificate", () => {
    it("lists the certificates and signs in with the picked one", async () => {
      const answers: string[] = [];
      ask(
        requestFor(answers, "client-certificate", {
          details: ["Ada\nExample CA", "Ada (work)\nWork CA"],
          origin: "https://intranet.example",
        }),
      );

      const dialog = screen.getByRole("alertdialog", {
        name: "Choose a certificate",
      });
      expect(dialog).toHaveAccessibleDescription(
        "intranet.example asks for a certificate to sign you in.",
      );
      await userEvent.click(within(dialog).getByText("Ada (work)"));
      await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

      expect(answers).toStrictEqual(["accept 1 "]);
    });

    it("continues without one", async () => {
      const answers: string[] = [];
      ask(
        requestFor(answers, "client-certificate", {
          details: ["Ada\nExample CA"],
        }),
      );

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(answers).toStrictEqual(["dismiss"]);
    });
  });

  describe("Bluetooth pairing", () => {
    it("sends the typed PIN", async () => {
      const answers: string[] = [];
      ask(requestFor(answers, "bluetooth-pin", { subject: "Keyboard K380" }));

      await userEvent.type(screen.getByLabelText("PIN"), "0000{Enter}");

      expect(answers).toStrictEqual(["accept 0 0000"]);
    });

    it("asks to check the PIN the device shows", () => {
      ask(
        requestFor([], "bluetooth-confirm", {
          pin: "123456",
          subject: "Keyboard K380",
        }),
      );

      expect(
        screen.getByRole("alertdialog", { name: "Pair with Keyboard K380?" }),
      ).toHaveAccessibleDescription("Check that Keyboard K380 shows 123456.");
    });
  });

  describe("an extension", () => {
    it("lists the permissions it asks for", async () => {
      const answers: string[] = [];
      ask(
        requestFor(answers, "extension-permissions", {
          details: ["Read your browsing history"],
          origin: "chrome-extension://abcdefghijklmnop",
          subject: "Dark Reader",
        }),
      );

      const dialog = screen.getByRole("alertdialog", {
        name: "Dark Reader wants more permissions",
      });
      expect(
        within(dialog).getByText("Read your browsing history"),
      ).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Allow" }));

      expect(answers).toStrictEqual(["accept 0 "]);
    });

    it("says when an extension to add needs no permissions", () => {
      ask(requestFor([], "extension-install", { subject: "Dark Reader" }));

      expect(
        screen.getByRole("alertdialog", { name: "Add Dark Reader?" }),
      ).toHaveAccessibleDescription("It needs no special permissions.");
    });
  });
});
