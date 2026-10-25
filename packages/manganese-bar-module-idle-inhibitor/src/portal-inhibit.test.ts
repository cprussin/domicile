import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type {
  DbusBody,
  DbusCall,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Bus, SystemErrorKind } from "@domicile-desktop/sdk/system";

import { inhibitIdle } from "./portal-inhibit";

const HANDLE = "/org/freedesktop/portal/desktop/request/1_42/t";

const REFUSED: SystemError = {
  kind: SystemErrorKind.Dbus,
  message: "org.freedesktop.DBus.Error.ServiceUnknown",
};

/** The session bus as xdg-desktop-portal answers it, or failing `failure`. */
const portal = (failure?: SystemError) => {
  const asked: DbusCall[] = [];
  return {
    asked,
    call: (call: DbusCall) => {
      asked.push(call);
      const body: DbusBody =
        call.member === "Inhibit"
          ? { body: [HANDLE], signature: "o" }
          : { body: [], signature: "" };
      return Promise.resolve(
        failure === undefined
          ? Ok<DbusBody, SystemError>(body)
          : Err<DbusBody, SystemError>(failure),
      );
    },
  };
};

/** The release a held inhibitor returned, or a failure that names the error. */
const held = <T extends NonNullable<unknown>>(result: Result<T, SystemError>) =>
  result.match({
    Err: (error) => {
      throw new Error(`the inhibitor failed: ${error.message}`);
    },
    Ok: (release) => release,
  });

describe("inhibitIdle", () => {
  it("asks the Inhibit portal for an idle inhibitor", async () => {
    const bus = portal();

    await inhibitIdle(bus);

    expect(bus.asked).toEqual([
      {
        body: [
          "",
          8,
          { reason: { signature: "s", value: "Kept awake from the bar" } },
        ],
        bus: Bus.Session,
        destination: "org.freedesktop.portal.Desktop",
        interface: "org.freedesktop.portal.Inhibit",
        member: "Inhibit",
        path: "/org/freedesktop/portal/desktop",
        signature: "sua{sv}",
      },
    ]);
  });

  it("lets go by closing the request the portal returned", async () => {
    const bus = portal();

    const release = held(await inhibitIdle(bus));
    expect(await release()).toStrictEqual(Ok("released"));

    expect(bus.asked[1]).toEqual({
      bus: Bus.Session,
      destination: "org.freedesktop.portal.Desktop",
      interface: "org.freedesktop.portal.Request",
      member: "Close",
      path: HANDLE,
    });
  });

  it("fails as the portal call failed", async () => {
    expect(await inhibitIdle(portal(REFUSED))).toStrictEqual(Err(REFUSED));
  });
});
