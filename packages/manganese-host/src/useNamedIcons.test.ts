import { describe, expect, it, spyOn } from "bun:test";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import { renderHook, waitFor } from "@testing-library/react";

import type { NamedIcons } from "./useNamedIcons";
import { useNamedIcons } from "./useNamedIcons";

/** Icons for the names in `pictures`, none for any other. */
const answering =
  (pictures: Readonly<Record<string, string>>): NamedIcons<string> =>
  () =>
    Promise.resolve(
      Ok((name: string) => {
        const picture = pictures[name];
        return Promise.resolve(
          Ok(picture === undefined ? None<string>() : Some(picture)),
        );
      }),
    );

describe(useNamedIcons, () => {
  it("finds each name's icon, leaving out empty names and names with none", async () => {
    const { domicile } = new FakeDomicileHost();
    const { result } = renderHook(() =>
      useNamedIcons(
        domicile,
        ["kitty", "org.example.None", "", "kitty"],
        answering({ kitty: "data:kitty" }),
        "Could not read the icons",
      ),
    );

    await waitFor(() => {
      expect([...result.current]).toStrictEqual([["kitty", "data:kitty"]]);
    });
  });

  it("logs a lookup the desktop refuses, as what failed", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => undefined);
    const { domicile } = new FakeDomicileHost();
    const refused: NamedIcons<string> = () =>
      Promise.resolve(
        Err({ kind: SystemErrorKind.Other, message: "no theme" }),
      );
    const { result } = renderHook(() =>
      useNamedIcons(domicile, ["kitty"], refused, "Could not read the icons"),
    );

    const failures = () =>
      logged.mock.calls.filter(([what]) => what === "Could not read the icons");
    await waitFor(() => {
      expect(failures()).toHaveLength(1);
    });
    expect(String(failures()[0]?.[1])).toContain("no theme");
    expect([...result.current]).toStrictEqual([]);
    logged.mockRestore();
  });
});
