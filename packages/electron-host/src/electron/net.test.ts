import { afterAll, describe, expect, it } from "bun:test";

import { net } from "./net";

const server = Bun.serve({
  fetch: async (request) =>
    new Response(
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

  it("emits error when the request can't be made", async () => {
    const request = net.request("http://localhost:1/nothing");
    const failed = new Promise((resolve) => request.on("error", resolve));
    request.end();
    expect(await failed).toBeInstanceOf(Error);
  });
});
