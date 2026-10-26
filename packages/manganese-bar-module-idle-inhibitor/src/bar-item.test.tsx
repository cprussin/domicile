import { describe, expect, it } from "bun:test";
import { DomicileProvider } from "@domicile-desktop/react/domicile-provider";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IdleInhibitor } from "./bar-item";

/** The system calls the shell made, as the compositor reads them. */
const requests = (fake: FakeDomicileHost): unknown[] =>
  fake.calls
    .filter(([method]) => method === "callSystem")
    .map(([, , request]) => JSON.parse(String(request)));

describe("IdleInhibitor", () => {
  it("asks the desk's Inhibit portal, once for every bar", async () => {
    const fake = new FakeDomicileHost();
    render(
      <DomicileProvider domicile={fake.domicile}>
        <IdleInhibitor />
        <IdleInhibitor />
      </DomicileProvider>,
    );

    await userEvent.click(screen.getAllByRole("button")[0] as HTMLElement);

    expect(requests(fake)).toEqual([
      expect.objectContaining({ call: "dbus_call", member: "Inhibit" }),
    ]);
    for (const toggle of screen.getAllByRole("button")) {
      expect(toggle).toBeDisabled();
    }
  });
});
