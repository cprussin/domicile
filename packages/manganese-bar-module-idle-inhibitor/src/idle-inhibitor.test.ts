import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import { Inhibiting, idleInhibitor } from "./idle-inhibitor";
import type { Release } from "./portal-inhibit";

const REFUSED: SystemError = {
  kind: SystemErrorKind.Dbus,
  message: "org.freedesktop.DBus.Error.ServiceUnknown",
};

/** A portal that answers each request when the test says. */
const portal = () => {
  const taking = Promise.withResolvers<Result<Release, SystemError>>();
  const releasing = Promise.withResolvers<Result<"released", SystemError>>();
  return {
    inhibit: () => taking.promise,
    release: () => releasing.promise,
    releasing,
    taking,
  };
};

/** Every state `inhibitor` passes through until `settled` resolves. */
const statesUntil = async (
  inhibitor: ReturnType<typeof idleInhibitor>,
  act: () => void,
  settled: () => Promise<unknown>,
) => {
  const states: Inhibiting[] = [];
  const stop = inhibitor.subscribe(() => states.push(inhibitor.current()));
  act();
  await settled();
  stop();
  return states;
};

describe("idleInhibitor", () => {
  it("holds an inhibitor on the first toggle and lets go on the next", async () => {
    const answers = portal();
    const inhibitor = idleInhibitor(answers.inhibit);

    expect(inhibitor.current()).toBe(Inhibiting.Off);
    expect(
      await statesUntil(inhibitor, inhibitor.toggle, async () => {
        answers.taking.resolve(Ok(answers.release));
        await answers.taking.promise;
      }),
    ).toEqual([Inhibiting.Taking, Inhibiting.On]);
    expect(
      await statesUntil(inhibitor, inhibitor.toggle, async () => {
        answers.releasing.resolve(Ok("released"));
        await answers.releasing.promise;
      }),
    ).toEqual([Inhibiting.Releasing, Inhibiting.Off]);
  });

  it("stays off and logs when the portal refuses", async () => {
    const answers = portal();
    const logged = new Promise((resolve) => {
      const inhibitor = idleInhibitor(answers.inhibit, (...said) => {
        resolve([...said, inhibitor.current()]);
      });
      inhibitor.toggle();
    });

    answers.taking.resolve(Err(REFUSED));

    expect(await logged).toEqual(["hold", REFUSED, Inhibiting.Off]);
  });

  it("stays on and logs when letting go fails", async () => {
    const answers = portal();
    const logged = new Promise((resolve) => {
      const inhibitor = idleInhibitor(answers.inhibit, (...said) => {
        resolve([...said, inhibitor.current()]);
      });
      inhibitor.toggle();
      answers.taking.promise
        .then(() => {
          inhibitor.toggle();
        })
        .catch(resolve);
    });

    answers.taking.resolve(Ok(answers.release));
    answers.releasing.resolve(Err(REFUSED));

    expect(await logged).toEqual(["release", REFUSED, Inhibiting.On]);
  });

  it("refuses a toggle while the portal has not answered", () => {
    const inhibitor = idleInhibitor(portal().inhibit);

    inhibitor.toggle();

    expect(inhibitor.toggle).toThrow("the idle inhibitor is still changing");
  });
});
