import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

import type { ProtocolRequest } from "./protocol";
import { createProtocols } from "./protocol";

const setUp = () => {
  const sent: ProtocolRequest[] = [];
  const protocols = createProtocols((request) => sent.push(request));
  return { protocols, sent };
};

const get = (url: string, session = "") => ({
  headers: [["accept", "*/*"]] as [string, string][],
  method: "GET",
  request: 1,
  session,
  url,
});

describe(createProtocols, () => {
  it("serves file: in each session it makes, as Electron does", async () => {
    const { protocols, sent } = setUp();

    protocols.forSession("");
    protocols.forSession("persist:other");
    await protocols.answer(get("file:///opt/app/index.html"));

    expect(sent).toEqual([
      { scheme: "file", session: "", type: "handle_protocol" },
      { scheme: "file", session: "persist:other", type: "handle_protocol" },
      {
        file: "/opt/app/index.html",
        headers: [],
        request: 1,
        status: 200,
        type: "protocol_response",
      },
    ]);
  });

  it("asks a handler and streams its response", async () => {
    const { protocols, sent } = setUp();
    const protocol = protocols.forSession("");
    const asked: string[] = [];
    protocol.handle("app", (request) => {
      asked.push(`${request.method} ${request.url}`);
      return new Response("hi", {
        headers: { "content-type": "text/plain" },
        status: 201,
      });
    });
    sent.length = 0;

    await protocols.answer(get("app://localhost/a"));

    expect(asked).toEqual(["GET app://localhost/a"]);
    expect(sent).toEqual([
      {
        headers: [["content-type", "text/plain"]],
        request: 1,
        status: 201,
        stream: true,
        type: "protocol_response",
      },
      { data: "aGk=", request: 1, type: "protocol_data" },
      { request: 1, type: "protocol_end" },
    ]);
  });

  it("gives a handler the request's body and headers", async () => {
    const { protocols } = setUp();
    let seen = "";
    protocols.forSession("").handle("https", async (request) => {
      seen = `${request.headers.get("x-a")} ${await request.text()}`;
      return new Response(null, { status: 204 });
    });

    await protocols.answer({
      body: Buffer.from("hello").toString("base64"),
      headers: [["x-a", "1"]],
      method: "POST",
      request: 4,
      session: "",
      url: "https://a.test/",
    });

    expect(seen).toBe("1 hello");
  });

  it("answers an empty body whole", async () => {
    const { protocols, sent } = setUp();
    protocols
      .forSession("")
      .handle("app", () => new Response(null, { status: 204 }));
    sent.length = 0;

    await protocols.answer(get("app://localhost/"));

    expect(sent).toEqual([
      {
        body: "",
        headers: [],
        request: 1,
        status: 204,
        type: "protocol_response",
      },
    ]);
  });

  it("fails the request when the handler throws or answers an error", async () => {
    const { protocols, sent } = setUp();
    const protocol = protocols.forSession("");
    protocol.handle("app", () => {
      throw new Error("no such page");
    });
    protocol.handle("other", () => Response.error());
    sent.length = 0;

    await protocols.answer(get("app://localhost/"));
    await protocols.answer({ ...get("other://x/"), request: 2 });

    expect(sent).toEqual([
      { error: "no such page", request: 1, type: "protocol_response" },
      {
        error: "the other: handler answered with a network error",
        request: 2,
        type: "protocol_response",
      },
    ]);
  });

  it("handles a scheme once, until it is unhandled", () => {
    const { protocols, sent } = setUp();
    const protocol = protocols.forSession("");
    const handler = () => new Response("");

    expect(protocol.handle("app", handler)).toBeUndefined();
    expect(() => protocol.handle("app", handler)).toThrow(
      "Failed to register protocol: app",
    );
    expect(protocol.isProtocolHandled("app")).toBe(true);
    protocol.unhandle("app");
    expect(protocol.isProtocolHandled("app")).toBe(false);
    expect(sent.slice(1)).toEqual([
      { scheme: "app", session: "", type: "handle_protocol" },
      { scheme: "app", session: "", type: "unhandle_protocol" },
    ]);
  });

  it("keeps file: served when the app's own file: handler goes", async () => {
    const { protocols, sent } = setUp();
    const protocol = protocols.forSession("");
    protocol.handle("file", () => new Response("mine"));
    protocol.unhandle("file");
    sent.length = 0;

    await protocols.answer(get("file:///a"));

    expect(sent).toEqual([
      {
        file: "/a",
        headers: [],
        request: 1,
        status: 200,
        type: "protocol_response",
      },
    ]);
  });

  it("keeps sessions' handlers apart", async () => {
    const { protocols, sent } = setUp();
    protocols.forSession("persist:a").handle("app", () => new Response("a"));
    protocols.forSession("");
    sent.length = 0;

    await protocols.answer(get("app://x/"));

    expect(sent).toEqual([
      {
        error: "nothing handles app: in this session",
        request: 1,
        type: "protocol_response",
      },
    ]);
  });

  it("fails a file: URL that names another host", async () => {
    const { protocols, sent } = setUp();
    protocols.forSession("");
    sent.length = 0;

    await protocols.answer(get("file://elsewhere/a"));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ request: 1, type: "protocol_response" });
    expect(sent[0]).toHaveProperty("error");
  });
});

describe("the protocol registrations before protocol.handle", () => {
  it("answers a registerFileProtocol scheme with the file its handler names", async () => {
    const dir = await mkdtemp(`${tmpdir()}/legacy-protocol-`);
    await Bun.write(`${dir}/index.html`, "<title>Element</title>");
    const { protocols } = setUp();
    const protocol = protocols.forSession("");

    expect(
      protocol.registerFileProtocol("vector", (request, callback) => {
        const { pathname } = new URL((request as { url: string }).url);
        callback({ path: `${dir}${pathname}` });
      }),
    ).toBe(true);
    expect(protocol.isProtocolRegistered("vector")).toBe(true);
    expect(protocol.isProtocolHandled("vector")).toBe(true);

    expect(protocol.unregisterProtocol("vector")).toBe(true);
    expect(protocol.isProtocolHandled("vector")).toBe(false);
  });

  it("gives each kind of answer as a response", async () => {
    const { legacyResponse } = await import("./protocol");

    const text = await legacyResponse("string", {
      charset: "utf-8",
      data: "hi",
      mimeType: "text/plain",
    });
    expect(await text.text()).toBe("hi");
    expect(text.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect((await legacyResponse("buffer", Buffer.from("raw"))).status).toBe(
      200,
    );
    expect((await legacyResponse("file", { error: -6 })).status).toBe(404);
    expect((await legacyResponse("file", "/no/such/file")).status).toBe(404);
  });
});
