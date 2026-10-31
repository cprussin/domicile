import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Faq } from "./Faq";

test("each answer opens from its question and links to the detail", async () => {
  render(<Faq />);
  const question = screen.getByText("Can websites use the desktop APIs?");

  await userEvent.click(question);

  const answer = question.closest("details");
  expect(answer).toHaveAttribute("open");
  expect(screen.getByRole("link", { name: "System access" })).toHaveAttribute(
    "href",
    "/docs/shells/system-access",
  );
});
