// An idle inhibitor from the Inhibit portal, the way an application takes one.
//
// The shell has no Wayland surface for `zwp_idle_inhibit_manager_v1`. The
// portal's idle flag needs none, and xdg-desktop-portal closes a request when
// its caller leaves the bus. The compositor gives each page its own bus
// connection, so a shell reload lets go of the inhibitor. See docs/IDLE.md.

import type { Result } from "@cprussin/option-result";
import type { Dbus } from "@domicile-desktop/sdk/desktop/dbus";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { Bus } from "@domicile-desktop/sdk/system";
import { z } from "zod";

/** The portal's flag for holding off the idle timer. */
const IDLE = 8;

const PORTAL = "org.freedesktop.portal.Desktop";

/** Lets go of a held inhibitor. */
export type Release = () => Promise<Result<"released", SystemError>>;

/** Holds an idle inhibitor, and resolves with what lets go of it. */
export const inhibitIdle = async (
  bus: Pick<Dbus, "call">,
): Promise<Result<Release, SystemError>> => {
  const held = await bus.call({
    body: [
      "",
      IDLE,
      { reason: { signature: "s", value: "Kept awake from the bar" } },
    ],
    bus: Bus.Session,
    destination: PORTAL,
    interface: "org.freedesktop.portal.Inhibit",
    member: "Inhibit",
    path: "/org/freedesktop/portal/desktop",
    signature: "sua{sv}",
  });
  return held.map(({ body }) => releaseOf(bus, handleSchema.parse(body)[0]));
};

const handleSchema = z.tuple([z.string()]);

const releaseOf =
  (bus: Pick<Dbus, "call">, handle: string): Release =>
  async () =>
    (
      await bus.call({
        bus: Bus.Session,
        destination: PORTAL,
        interface: "org.freedesktop.portal.Request",
        member: "Close",
        path: handle,
      })
    ).map(() => "released" as const);
