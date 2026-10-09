import { describe, expect, it, spyOn } from "bun:test";
import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type { watchIconTheme } from "@domicile-desktop/sdk/icon-theme";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";

import { followIconTheme } from "./followed-icon-theme";

type Report = (theme: Result<Option<string>, SystemError>) => void;

/** A watch the test reports through, and how often it was started. */
const watching = () => {
  const reports = Promise.withResolvers<Report>();
  const state = { started: 0 };
  const watch: typeof watchIconTheme = (_system, listener) => {
    state.started += 1;
    reports.resolve(listener);
    return () => undefined;
  };
  return { report: reports.promise, state, watch };
};

describe("followIconTheme", () => {
  it("answers with the theme as last reported, from one watch", async () => {
    const { report, state, watch } = watching();
    const theme = followIconTheme(fakeSystem({}), watch);
    const first = theme();

    (await report)(Ok(Some("Papirus")));
    expect(await first).toBe("Papirus");
    (await report)(Ok(None()));
    expect(await theme()).toBeUndefined();
    (await report)(Ok(Some("Adwaita")));
    expect(await theme()).toBe("Adwaita");
    expect(state.started).toBe(1);
  });

  it("logs a theme it cannot read, and answers hicolor", async () => {
    const logged = Promise.withResolvers<unknown[]>();
    spyOn(console, "error").mockImplementationOnce((...args) => {
      logged.resolve(args);
    });
    const { report, watch } = watching();
    const theme = followIconTheme(fakeSystem({}), watch);
    const refused = { kind: SystemErrorKind.Dbus, message: "no portal" };

    (await report)(Err(refused));

    expect(await theme()).toBeUndefined();
    expect(await logged.promise).toStrictEqual([
      "Could not read the icon theme; drawing hicolor icons",
      refused,
    ]);
  });
});
