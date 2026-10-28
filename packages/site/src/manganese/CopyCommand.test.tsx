import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CopyCommand } from "./CopyCommand";

test("a command shows a shell prompt", () => {
  expect(renderToStaticMarkup(<CopyCommand command="ls" />)).toContain(
    ">$</span>",
  );
});

test("a message, such as a prompt for an agent, shows none", () => {
  expect(
    renderToStaticMarkup(<CopyCommand command="Hi" kind="message" />),
  ).not.toContain("$");
});
