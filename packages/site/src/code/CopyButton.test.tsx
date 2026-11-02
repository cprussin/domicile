import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CopyButton } from "./CopyButton";

const HEREDOC = `sudo tee /etc/yum.repos.d/domicile.repo <<'REPO'
[domicile]
name="Domicile"
REPO`;

describe("CopyButton", () => {
  test("copies the text as given and says so", async () => {
    const copied = new Promise<string>((resolve) => {
      render(
        <CopyButton
          text={HEREDOC}
          write={(text) => {
            resolve(text);
            return Promise.resolve();
          }}
        />,
      );
    });

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(await copied).toBe(HEREDOC);
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
  });

  test("goes back to Copy, so it can be pressed again", async () => {
    render(<CopyButton text="ls" write={() => Promise.resolve()} />);

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    await screen.findByRole("button", { name: "Copied" });

    expect(
      await screen.findByRole("button", { name: "Copy" }, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  test("says when the clipboard refused", async () => {
    render(
      <CopyButton
        text="ls"
        write={() => Promise.reject(new Error("denied"))}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(
      await screen.findByRole("button", { name: "Copy failed" }),
    ).toBeInTheDocument();
  });
});
