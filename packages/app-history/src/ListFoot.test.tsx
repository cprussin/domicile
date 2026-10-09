import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ListFoot } from "./ListFoot";

describe(ListFoot, () => {
  it("offers to try again after a page fails, instead of loading by itself", async () => {
    const user = userEvent.setup();
    await new Promise<void>((resolve) => {
      render(
        <ListFoot
          complete={false}
          failed
          loading={false}
          onLoadMore={() => undefined}
          onRetry={resolve}
        />,
      );
      user
        .click(screen.getByRole("button", { name: "Try again" }))
        .catch(() => undefined);
    });
  });

  it("says when every row has loaded", () => {
    render(
      <ListFoot
        complete
        failed={false}
        loading={false}
        onLoadMore={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText("That's everything")).toBeInTheDocument();
  });
});
