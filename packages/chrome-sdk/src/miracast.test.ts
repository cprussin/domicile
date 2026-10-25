import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

import type { CastTarget, Sending } from "./cast";
import { miracastCast } from "./miracast";
import type {
  DbusBody,
  DbusCall,
  DbusMatch,
  DbusSignal,
  Listened,
  Listening,
  SystemError,
} from "./system";
import { Listened as Heard, SystemErrorKind } from "./system";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const TV: CastTarget = {
  id: "p2p:/peer/1",
  mode: { height: 1080, refreshMhz: 30_000, width: 1920 },
  name: "Fire TV",
  unreachable: undefined,
};

/** The service on the session bus, whose signals the test sends. */
class FakeService {
  calls: DbusCall[] = [];
  sinks: [string, string][] = [];
  castReply: Result<DbusBody, SystemError> = Ok({
    body: ["cast-0"],
    signature: "s",
  });
  missing = false;
  readonly listeners = new Map<
    string,
    Set<ReadableStreamDefaultController<Listened<DbusSignal>>>
  >();

  readonly dbus = {
    call: (call: DbusCall): Promise<Result<DbusBody, SystemError>> => {
      this.calls.push(call);
      if (this.missing) {
        return Promise.resolve(
          Err({
            kind: SystemErrorKind.Dbus,
            message:
              "org.freedesktop.DBus.Error.ServiceUnknown: The name net.domicile.Miracast was not provided",
          }),
        );
      }
      switch (call.member) {
        case "Sinks":
          return Promise.resolve(
            Ok({ body: [this.sinks], signature: "a(ss)" }),
          );
        case "Cast":
          return Promise.resolve(this.castReply);
        default:
          return Promise.resolve(Ok({ body: [], signature: "" }));
      }
    },
    match: (
      match: DbusMatch,
    ): Promise<Result<Listening<Listened<DbusSignal>>, SystemError>> => {
      const member = match.member ?? "";
      const held = this.listeners.get(member) ?? new Set();
      this.listeners.set(member, held);
      const state: {
        controller?: ReadableStreamDefaultController<Listened<DbusSignal>>;
      } = {};
      const items = new ReadableStream<Listened<DbusSignal>>({
        start: (controller) => {
          state.controller = controller;
          held.add(controller);
        },
      });
      const listening: Listening<Listened<DbusSignal>> = {
        ended: Promise.resolve(Ok("stopped" as const)),
        items,
        stop: () => {
          if (state.controller !== undefined && held.delete(state.controller)) {
            state.controller.close();
          }
        },
      };
      return Promise.resolve(Ok(listening));
    },
  };

  emit(member: string, body: unknown[]) {
    for (const controller of this.listeners.get(member) ?? []) {
      controller.enqueue(
        Heard.Heard({
          body,
          interface: "net.domicile.Miracast1",
          member,
          path: "/net/domicile/Miracast",
          sender: ":1.2",
          signature: "",
        }),
      );
    }
  }
}

describe("miracastCast", () => {
  it("lists the service's TVs, at 1080p30, as they change", async () => {
    const service = new FakeService();
    const heard: (readonly CastTarget[])[] = [];
    miracastCast(service).watchTargets((targets) => {
      heard.push(targets);
    });
    await settle();
    service.sinks = [["p2p:/peer/1", "Fire TV"]];
    service.emit("SinksChanged", []);
    await settle();

    expect(heard).toEqual([[], [TV]]);
  });

  it("is one backend per desktop, whose listeners share one watch", async () => {
    const service = new FakeService();
    service.sinks = [["p2p:/peer/1", "Fire TV"]];
    const heard: (readonly CastTarget[])[] = [];
    miracastCast(service).watchTargets(() => undefined);
    await settle();
    miracastCast(service).watchTargets((targets) => {
      heard.push(targets);
    });

    expect(miracastCast(service)).toBe(miracastCast(service));
    expect(service.calls.map(({ member }) => member)).toEqual(["Sinks"]);
    expect(heard).toEqual([[TV]]);
  });

  it("lists nothing where the service is not installed", async () => {
    const service = new FakeService();
    service.missing = true;
    const heard: (readonly CastTarget[])[] = [];
    miracastCast(service).watchTargets((targets) => {
      heard.push(targets);
    });
    await settle();

    expect(heard).toEqual([[]]);
  });

  it("casts once the TV plays, and stops it", async () => {
    const service = new FakeService();
    const sending = miracastCast(service).send("p2p:/peer/1");
    await settle();
    service.emit("Started", ["cast-0"]);
    const sent = await sending;
    sent.match({
      Err: () => undefined,
      Ok: ({ stop }) => {
        stop();
      },
    });

    expect(sent.isOk()).toBe(true);
    expect(service.calls.map(({ member, body }) => [member, body])).toEqual([
      ["Cast", ["p2p:/peer/1"]],
      ["Stop", ["cast-0"]],
    ]);
  });

  it("says why a cast never played", async () => {
    const service = new FakeService();
    const sending = miracastCast(service).send("p2p:/peer/1");
    await settle();
    service.emit("Ended", ["cast-0", "the TV didn't accept the connection"]);

    expect(await sending).toStrictEqual(
      Err("the TV didn't accept the connection"),
    );
  });

  it("ends when the service says the cast ended", async () => {
    const service = new FakeService();
    const sending = miracastCast(service).send("p2p:/peer/1");
    await settle();
    service.emit("Started", ["cast-0"]);
    const heard: string[] = [];
    (await sending).match({
      Err: () => undefined,
      Ok: (sent: Sending) => {
        void sent.ended.then(() => {
          heard.push("ended");
        });
      },
    });
    service.emit("Ended", ["cast-1", ""]);
    await settle();
    expect(heard).toEqual([]);

    service.emit("Ended", ["cast-0", ""]);
    await settle();
    expect(heard).toEqual(["ended"]);
  });

  it("says Miracast is missing when the service is not installed", async () => {
    const service = new FakeService();
    service.missing = true;

    expect(await miracastCast(service).send("p2p:/peer/1")).toStrictEqual(
      Err("Miracast isn't available on this computer"),
    );
  });

  it("says why the service refused, without the error's name", async () => {
    const service = new FakeService();
    service.castReply = Err({
      kind: SystemErrorKind.Dbus,
      message: "org.freedesktop.DBus.Error.InvalidArgs: the TV is gone",
    });

    expect(await miracastCast(service).send("p2p:/peer/1")).toStrictEqual(
      Err("the TV is gone"),
    );
  });
});
