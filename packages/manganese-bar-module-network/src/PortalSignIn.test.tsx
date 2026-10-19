import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PortalSignIn } from "./PortalSignIn";

describe("PortalSignIn", () => {
  it("shows the sign-in page in a dialog", () => {
    render(
      <PortalSignIn
        onDismiss={() => undefined}
        screen={undefined}
        url="http://10.0.0.1/login"
      />,
    );
    const dialog = screen.getByRole("dialog", {
      name: "Sign in to the network",
    });
    expect(dialog.querySelector("webview")?.getAttribute("src")).toBe(
      "http://10.0.0.1/login",
    );
  });

  it("shows nothing without a page", () => {
    render(
      <PortalSignIn
        onDismiss={() => undefined}
        screen={undefined}
        url={undefined}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is dismissed by its close button", async () => {
    const dismissed = new Promise((resolve) => {
      render(
        <PortalSignIn
          onDismiss={() => {
            resolve(true);
          }}
          screen={undefined}
          url="http://10.0.0.1/login"
        />,
      );
    });
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await dismissed).toBe(true);
  });
});
