import { describe, expect, it } from "bun:test";
import { DomicileProvider } from "@domicile-desktop/react/domicile-provider";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { KeptAwake } from "./kept-awake";
import { KeepAwake } from "./quick-settings";

describe("KeepAwake", () => {
  it("shares the desk's inhibitor with the bar's pill", async () => {
    const fake = new FakeDomicileHost();
    render(
      <DomicileProvider domicile={fake.domicile}>
        <KeptAwake />
        <KeepAwake />
      </DomicileProvider>,
    );
    expect(screen.queryByRole("button", { name: "Kept awake" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Keep awake" }));

    expect(
      screen.getByRole("button", { name: "Kept awake" }),
    ).toBeInTheDocument();
  });
});
