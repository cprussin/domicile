import { describe, expect, it } from "bun:test";
import type { DomicileAppHost } from "@domicile-desktop/sdk/app";
import { act, within } from "@testing-library/react";

import { main } from "./index";

describe(main, () => {
  it("mounts the app into its root, names the window and starts the app host", async () => {
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
    expect(document.title).toBe("History");
    expect(
      within(root).getByRole("searchbox", { name: "Search history" }),
    ).toBeInTheDocument();
    expect(calls).toContainEqual(
      expect.objectContaining({
        argv: ["domicile-app-host"],
        call: "spawn",
        stdin: true,
      }),
    );
    root.remove();
  });
});
