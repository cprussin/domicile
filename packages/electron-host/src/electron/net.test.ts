import { afterAll, describe, expect, it } from "bun:test";

import { net } from "./net";

const server = Bun.serve({
  fetch: async (request) =>
    new URL(request.url).pathname === "/slow"
      ? new Response(
          new ReadableStream({
            start: (controller) => {
              controller.enqueue(new TextEncoder().encode("first"));
            },
          }),
        )
      : new Response(
          `${request.method} ${new URL(request.url).pathname} ${await request.text()} ${request.headers.get("x-app")}`,
          {
            headers: { "x-answer": "yes" },
            status: 201,
          },
        ),
  port: 0,
});
afterAll(() => server.stop());

describe("net.request", () => {
  it("sends what was written and gives the response as Electron's", async () => {
    const request = net.request({
      method: "POST",
      url: `http://localhost:${server.port}/upload`,
    });
    request.setHeader("x-app", "slack");
    const answer = new Promise<{
      status: number;
      header: unknown;
      body: string;
    }>((resolve) => {
      request.on("response", (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        response.on("end", () =>
          resolve({
            body,
            header: response.headers["x-answer"],
            status: response.statusCode,
          }),
        );
      });
    });
    request.write("hello ");
    request.end("world");

    expect(await answer).toEqual({
      body: "POST /upload hello world slack",
      header: "yes",
      status: 201,
    });
  });

  it("reaches the host and port it is given, a host's own port first, as Electron does", async () => {
    const bodyOf = (options: Parameters<typeof net.request>[0]) =>
      new Promise<string>((resolve) => {
        const request = net.request(options);
        request.on("response", (response) => {
          let body = "";
          response.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          response.on("end", () => resolve(body));
        });
        request.end();
      });

    expect(
      await bodyOf({
        hostname: "localhost",
        path: "/a",
        port: Number(server.port),
      }),
    ).toStartWith("GET /a");
    expect(
      await bodyOf({
        host: `localhost:${server.port}`,
        hostname: "localhost",
        path: "/b",
      }),
    ).toStartWith("GET /b");
  });

  it("says its response was aborted when the request is aborted mid-body", async () => {
    const request = net.request(`http://localhost:${server.port}/slow`);
    const heard: string[] = [];
    const closed = new Promise<void>((resolve) => {
      request.on("response", (response) => {
        response.once("data", () => request.abort());
        response.on("aborted", () => heard.push("aborted"));
      });
      request.on("abort", () => heard.push("abort"));
      request.on("close", () => resolve());
    });
    request.end();
    await closed;

    expect(heard).toEqual(["aborted", "abort"]);
  });

  it("emits error when the request can't be made", async () => {
    const request = net.request("http://localhost:1/nothing");
    const failed = new Promise((resolve) => request.on("error", resolve));
    request.end();
    expect(await failed).toBeInstanceOf(Error);
  });
});
