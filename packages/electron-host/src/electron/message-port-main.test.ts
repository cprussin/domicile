import { describe, expect, it } from "bun:test";
import type { MessagePortMain, PortRequest } from "./message-port-main";
import { createPagePorts, MessageChannelMain } from "./message-port-main";

/** Resolves with the data of the next message on `port`. */
const nextMessage = (port: MessagePortMain) =>
  new Promise<unknown>((resolve) => {
    port.once("message", (event: { data: unknown }) => resolve(event.data));
  });

const pagePorts = () => {
  const sent: PortRequest[] = [];
  return { ports: createPagePorts((request) => sent.push(request)), sent };
};

describe(MessageChannelMain, () => {
  it("carries a message to the other end once it starts", async () => {
    const { port1, port2 } = new MessageChannelMain();
    port1.postMessage({ n: 1 });
    const message = nextMessage(port2);

    port2.start();

    expect(await message).toEqual({ n: 1 });
  });

  it("tells the other end when one closes, and carries nothing after", () => {
    const { port1, port2 } = new MessageChannelMain();
    const heard: string[] = [];
    port2.on("close", () => heard.push("close"));
    port2.on("message", () => heard.push("message"));
    port2.start();

    port1.close();
    port1.postMessage(1);

    expect(heard).toEqual(["close"]);
  });
});

describe(createPagePorts, () => {
  it("names a port given to a page and carries its partner's messages there", () => {
    const { ports, sent } = pagePorts();
    const { port1, port2 } = new MessageChannelMain();

    const names = ports.give(2, [port2]);
    port1.postMessage({ a: [1, undefined] });
    port1.close();

    expect(names).toEqual(["m1"]);
    expect(sent).toEqual([
      { data: { a: [1, null] }, port: "m1", type: "port_post", window: 2 },
      { port: "m1", type: "port_close", window: 2 },
    ]);
  });

  it("gives a port to a page once", () => {
    const { ports } = pagePorts();
    const { port2 } = new MessageChannelMain();
    ports.give(2, [port2]);

    expect(() => ports.give(2, [port2])).toThrow(
      "a MessagePortMain goes to a page once, from its MessageChannelMain",
    );
  });

  it("carries the page's messages and close to the partner", async () => {
    const { ports } = pagePorts();
    const { port1, port2 } = new MessageChannelMain();
    ports.give(2, [port2]);
    const closed = new Promise<void>((resolve) => {
      port1.once("close", () => resolve());
    });
    const message = nextMessage(port1);
    port1.start();

    ports.message(2, "m1", "hi");
    ports.closed(2, "m1");

    expect(await message).toBe("hi");
    await closed;
  });

  it("makes a port for each the page sent, linked to it", async () => {
    const { ports, sent } = pagePorts();

    const [port] = ports.take(2, ["r1"]);
    if (port === undefined) {
      throw new Error("no port taken");
    } else {
      const message = nextMessage(port);
      port.start();
      port.postMessage(5);
      ports.message(2, "r1", 50);

      expect(await message).toBe(50);
      expect(sent).toEqual([
        { data: 5, port: "r1", type: "port_post", window: 2 },
      ]);
    }
  });

  it("closes a window's ports when its page goes, and only that window's", () => {
    const { ports } = pagePorts();
    const heard: string[] = [];
    const [first, other] = [...ports.take(2, ["r1"]), ...ports.take(3, ["r1"])];
    first?.on("close", () => heard.push("window 2"));
    other?.on("close", () => heard.push("window 3"));

    ports.gone(2);

    expect(heard).toEqual(["window 2"]);
  });
});
