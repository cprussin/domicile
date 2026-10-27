import { describe, expect, it } from "bun:test";
import { DomicileProvider } from "@domicile-desktop/react/domicile-provider";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { KeepAwake, KeepAwakeIndicator } from "./quick-settings";

describe("KeepAwake", () => {
  it("shares the desk's inhibitor with the bar's eye", async () => {
    const fake = new FakeDomicileHost();
    render(
      <DomicileProvider domicile={fake.domicile}>
        <KeepAwakeIndicator />
        <KeepAwake />
      </DomicileProvider>,
    );
    expect(screen.queryByRole("img")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Keep awake" }));

    expect(
      screen.getByRole("img", { name: "Screens kept on" }),
    ).toBeInTheDocument();
  });
});
