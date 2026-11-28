import { describe, expect, it, mock } from "bun:test";
import { Ok } from "@cprussin/option-result";
import { z } from "zod";

import { Bus } from "../system";
import type { Dbus } from "./dbus";
import { allProperties, variant } from "./dbus-properties";

describe("allProperties", () => {
  const of = {
    bus: Bus.System,
    destination: "org.example.Service",
    interface: "org.example.Thing",
    path: "/org/example/Thing",
  };
  const schema = z.object({ Level: variant(z.number()) });

  it("calls GetAll for the interface and reads its values", async () => {
    const call = mock<Dbus["call"]>(() =>
      Promise.resolve(
        Ok({
          body: [{ Level: { signature: "u", value: 3 } }],
          signature: "a{sv}",
        }),
      ),
    );
    const read = await allProperties({ call }, of, schema);
    expect(read).toEqual(Ok({ Level: 3 }));
    expect(call).toHaveBeenCalledWith({
      body: ["org.example.Thing"],
      bus: Bus.System,
      destination: "org.example.Service",
      interface: "org.freedesktop.DBus.Properties",
      member: "GetAll",
      path: "/org/example/Thing",
      signature: "s",
    });
  });

  it("throws on a reply that doesn't match the schema", async () => {
    const call = mock<Dbus["call"]>(() =>
      Promise.resolve(Ok({ body: [{ Level: "high" }], signature: "a{sv}" })),
    );
    await expect(allProperties({ call }, of, schema)).rejects.toThrow();
  });
});
