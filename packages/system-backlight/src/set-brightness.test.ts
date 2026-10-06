import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type {
  DbusBody,
  DbusCall,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Bus, SystemErrorKind } from "@domicile-desktop/sdk/system";

import type { Devices } from "./fake-system";
import { fakeSysfs, panel, THINKPAD } from "./fake-system";
import { brightnessSetter, SetOutcome } from "./set-brightness";

/** What logind's `SetBrightness` returns: nothing. */
const RETURNED: DbusBody = { body: [], signature: "" };

type Asked = {
  call: DbusCall;
  answer: (result: Result<DbusBody, SystemError>) => void;
};

/** A machine whose logind answers each call when the test says. */
const machine = (devices: Devices | undefined) => {
  const sysfs = fakeSysfs(devices);
  const asked: Asked[] = [];
  const waiting: ((asked: Asked) => void)[] = [];
  const host = {
    ...sysfs.host,
    dbusCall: (call: DbusCall) =>
      new Promise<Result<DbusBody, SystemError>>((answer) => {
        const next = { answer, call };
        asked.push(next);
        waiting.shift()?.(next);
      }),
  };
  /** The `index`th call logind gets, once the setter has read `/sys`. */
  const nextCall = (index: number): Promise<Asked> => {
    const known = asked[index];
    return known === undefined
      ? new Promise((resolve) => {
          waiting.push(resolve);
        })
      : Promise.resolve(known);
  };
  return { asked, host, nextCall, sysfs };
};

const setTo = (device: string, raw: number): DbusCall => ({
  body: ["backlight", device, raw],
  bus: Bus.System,
  destination: "org.freedesktop.login1",
  interface: "org.freedesktop.login1.Session",
  member: "SetBrightness",
  path: "/org/freedesktop/login1/session/auto",
  signature: "ssu",
});

describe("brightnessSetter", () => {
  it("asks logind to set the preferred backlight", async () => {
    const { host, nextCall } = machine(THINKPAD);

    const setting = brightnessSetter(host)(0.5);
    const call = await nextCall(0);
    call.answer(Ok(RETURNED));

    expect(call.call).toStrictEqual(setTo("acpi_video0", 8));
    expect(await setting).toStrictEqual(Ok(SetOutcome.Set));
  });

  // The raw scale is the device's, and the device may have gone away.
  it("reads the device again for each level", async () => {
    const { host, nextCall, sysfs } = machine(THINKPAD);
    const set = brightnessSetter(host);
    const first = set(0.5);
    (await nextCall(0)).answer(Ok(RETURNED));
    await first;

    sysfs.set({ panel: panel("raw", "1") });
    const second = set(0.5);
    const call = await nextCall(1);
    call.answer(Ok(RETURNED));

    expect(call.call).toStrictEqual(setTo("panel", 500));
    expect(await second).toStrictEqual(Ok(SetOutcome.Set));
  });

  it("sets nothing on a machine without a backlight", async () => {
    const { asked, host } = machine(undefined);

    expect(await brightnessSetter(host)(0.5)).toStrictEqual(
      Ok(SetOutcome.NoBacklight),
    );
    expect(asked).toStrictEqual([]);
  });

  // A dragged slider asks many times while logind answers once.
  it("writes a drag where it ends up", async () => {
    const { asked, host, nextCall } = machine({ panel: panel("raw", "1") });
    const set = brightnessSetter(host);

    const first = set(0.1);
    const firstCall = await nextCall(0);
    const passed = [set(0.2), set(0.3)];
    const last = set(0.4);
    firstCall.answer(Ok(RETURNED));
    const lastCall = await nextCall(1);
    lastCall.answer(Ok(RETURNED));

    expect(await Promise.all([first, ...passed, last])).toStrictEqual([
      Ok(SetOutcome.Set),
      Ok(SetOutcome.Superseded),
      Ok(SetOutcome.Superseded),
      Ok(SetOutcome.Set),
    ]);
    expect(asked.map(({ call }) => call)).toStrictEqual([
      setTo("panel", 100),
      setTo("panel", 400),
    ]);
  });

  // An inactive session (after a console switch) may be active again by the
  // next request.
  it("says when logind refuses, and asks again next time", async () => {
    const { host, nextCall } = machine(THINKPAD);
    const set = brightnessSetter(host);
    const refused: SystemError = {
      kind: SystemErrorKind.Dbus,
      message: "org.freedesktop.DBus.Error.AccessDenied: not active",
    };

    const first = set(0.5);
    (await nextCall(0)).answer(Err(refused));
    expect(await first).toStrictEqual(Err(refused));

    const second = set(0.5);
    (await nextCall(1)).answer(Ok(RETURNED));
    expect(await second).toStrictEqual(Ok(SetOutcome.Set));
  });

  it("refuses a level that is not a number", async () => {
    const { asked, host } = machine(THINKPAD);

    await expect(brightnessSetter(host)(Number.NaN)).rejects.toThrow("NaN");
    expect(asked).toStrictEqual([]);
  });
});
