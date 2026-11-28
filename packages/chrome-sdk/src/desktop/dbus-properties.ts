// Reading a D-Bus object's properties: `Properties.GetAll`, and the `v`s it
// answers with. Kept out of `./dbus` so the engine's layer, which bundles
// that, doesn't take zod's schemas with it.

import type { Result } from "@cprussin/option-result";
import { z } from "zod";

import type { Bus, SystemError } from "../system";
import type { Dbus } from "./dbus";

/** A `v`, as `domicile_host::dbus_json` writes it, read as its value. */
export const variant = <T>(value: z.ZodType<T>) =>
  z.object({ value }).transform(({ value: held }) => held);

/** The object whose properties to read, and which of its interfaces. */
export type PropertiesOf = {
  bus: Bus;
  destination: string;
  path: string;
  interface: string;
};

/**
 * `org.freedesktop.DBus.Properties.GetAll` on `of`, parsed with `schema`.
 * Throws when the reply doesn't match it: a service that breaks its own
 * interface is a bug to hear about.
 */
export const allProperties = async <T extends NonNullable<unknown>>(
  dbus: Pick<Dbus, "call">,
  { interface: interfaceName, ...of }: PropertiesOf,
  schema: z.ZodType<T>,
): Promise<Result<T, SystemError>> =>
  (
    await dbus.call({
      ...of,
      body: [interfaceName],
      interface: "org.freedesktop.DBus.Properties",
      member: "GetAll",
      signature: "s",
    })
  ).map(({ body }) => z.tuple([schema]).parse(body)[0]);
