import { describe, expect, it } from "bun:test";
import type { DomicileAppHost } from "@domicile-desktop/sdk/app";
import { act, within } from "@testing-library/react";

import { main } from "./index";

describe(main, () => {
  it("mounts the app into its root, names the window and starts the settings host", async () => {
    const calls: unknown[] = [];
    const host: DomicileAppHost = {
      addEventListener: () => {
        /* the host never answers */
      },
      callSystem: (_id, request) => {
        calls.push(JSON.parse(request));
      },
      removeEventListener: () => {
        /* nothing listens */
      },
    };
    const root = document.createElement("div");
    document.body.append(root);
    await act(async () => {
      await main(root, host);
    });
    expect(document.title).toBe("Settings");
    expect(
      within(root).getByRole("button", { name: "Appearance" }),
    ).toBeInTheDocument();
    expect(calls).toContainEqual(
      expect.objectContaining({
        argv: ["domicile-settings-host"],
        call: "spawn",
        stdin: true,
      }),
    );
    root.remove();
  });
});
