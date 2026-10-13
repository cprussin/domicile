import { describe, expect, it } from "bun:test";
import { None, Ok, Some } from "@cprussin/option-result";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { renderHook, waitFor } from "@testing-library/react";

import type { ClientIcons } from "./client-icons";
import { useClientIcons } from "./useClientIcons";

/** Icons for the desktop ids in `pictures`, none for any other. */
const answering =
  (pictures: Readonly<Record<string, string>>): ClientIcons =>
  () =>
    Promise.resolve(
      Ok((desktopId: string) => {
        const picture = pictures[desktopId];
        return Promise.resolve(
          Ok(picture === undefined ? None<string>() : Some(picture)),
        );
      }),
    );

describe("useClientIcons", () => {
  it("finds each client's icon", async () => {
    const { host } = new FakeDomicileHost();
    const { result } = renderHook(() =>
      useClientIcons(
        host,
        ["kitty", "org.example.None", ""],
        answering({ kitty: "data:kitty" }),
      ),
    );

    await waitFor(() => {
      expect([...result.current]).toStrictEqual([["kitty", "data:kitty"]]);
    });
  });
});
