import { z } from "zod";

/** A `v`, as `domicile_host::dbus_json` writes it, read as its value. */
export const variant = <T>(value: z.ZodType<T>) =>
  z.object({ value }).transform(({ value: held }) => held);
