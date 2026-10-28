import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Builder } from "./Builder";
import { MODELS } from "./models";

const codeOf = async () => {
  await userEvent.click(screen.getByRole("tab", { name: "Code" }));
  return screen.getByRole("textbox", { name: "Your desktop's code" });
};

describe("Builder", () => {
  it("starts from the first window model", async () => {
    render(<Builder />);

    expect(await codeOf()).toHaveValue(MODELS[0].code);
  });

  it("starts over from the window model picked, keeping edits to each", async () => {
    render(<Builder />);
    fireEvent.change(await codeOf(), { target: { value: "// mine" } });

    await userEvent.click(screen.getByRole("button", { name: "Floating" }));
    expect(await codeOf()).toHaveValue(MODELS[1]?.code);

    await userEvent.click(screen.getByRole("button", { name: "Tiling" }));
    expect(await codeOf()).toHaveValue("// mine");
  });

  it("says what stops the code from running", async () => {
    render(<Builder />);
    fireEvent.change(await codeOf(), {
      target: { value: "export const Desktop = 1;" },
    });

    expect(
      await screen.findByText(/Export your desktop as `Shell`/),
    ).toBeInTheDocument();
  });

  it("shows how to run the desktop for real", async () => {
    render(<Builder />);

    await userEvent.click(
      screen.getByRole("button", { name: "Run it for real" }),
    );

    expect(
      within(screen.getByRole("dialog")).getByText(
        "domicile ~/Downloads/my-desktop.tsx",
      ),
    ).toBeInTheDocument();
  });

  it("copies a prompt for a coding agent with the code in it", async () => {
    render(<Builder />);

    await userEvent.click(
      screen.getByRole("button", {
        name: "Copy a prompt for your coding agent",
      }),
    );

    const prompt = await navigator.clipboard.readText();
    expect(prompt).toContain("https://domicile-desktop.com/llms.txt");
    expect(prompt).toContain(MODELS[0].code);
  });
});
