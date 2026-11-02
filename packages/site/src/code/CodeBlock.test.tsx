import { afterEach, describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CodeBlock } from "./CodeBlock";

const CODE = `cat <<'EOF' > ~/.config/domicile/domicile.json
{ "shell": "./shell.tsx" }
EOF`;

const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

afterEach(() => {
  if (clipboard === undefined) {
    Reflect.deleteProperty(navigator, "clipboard");
  } else {
    Object.defineProperty(navigator, "clipboard", clipboard);
  }
});

describe("CodeBlock", () => {
  test("has no copy button unless asked", () => {
    render(<CodeBlock code="ls" language="bash" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("copies its code to the clipboard as written", async () => {
    let copied: string | undefined;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied = text;
          return Promise.resolve();
        },
      },
    });
    render(<CodeBlock code={CODE} copy language="bash" />);

    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
    expect(copied).toBe(CODE);
  });
});
