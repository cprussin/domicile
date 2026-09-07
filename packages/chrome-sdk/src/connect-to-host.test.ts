import { describe, expect, it } from "bun:test";

import type { HostWindow } from "./connect-to-host";
import { connectToHost, hasHost } from "./connect-to-host";
import type { WebSocketLike } from "./websocket-transport";

const openNothing = (): WebSocketLike => ({
  addEventListener: () => undefined,
  readyState: 1,
  send: () => undefined,
});

const page = (protocol: string, host: string): HostWindow => ({
  location: { host, protocol },
});

describe("connectToHost", () => {
  it("opens the session on the page's own origin", () => {
    const asked: string[] = [];
    connectToHost(page("http:", "127.0.0.1:7777"), (url) => {
      asked.push(url);
      return openNothing();
    });

    expect(asked).toEqual(["ws://127.0.0.1:7777/domicile-session"]);
  });

  it("uses wss for a page served over https", () => {
    const asked: string[] = [];
    connectToHost(page("https:", "desktop.example"), (url) => {
      asked.push(url);
      return openNothing();
    });

    expect(asked).toEqual(["wss://desktop.example/domicile-session"]);
  });

  // A shell's page opened in an ordinary browser has no host and must still
  // render: that is how a shell is styled and laid out without a desktop
  // running. It must not throw, and it must not try to open a socket.
  it("does nothing, quietly, on a page with no host", () => {
    const asked: string[] = [];
    const transport = connectToHost(page("file:", ""), (url) => {
      asked.push(url);
      return openNothing();
    });

    expect(asked).toEqual([]);
    expect(() => transport.send('{"type":"hello"}')).not.toThrow();
    expect(() => transport.onMessage(() => undefined)).not.toThrow();
  });

  // `ws://` at an empty host is not a URL. A file: page has exactly that, and
  // this promises not to throw.
  it("does not build a socket url with no host", () => {
    const asked: string[] = [];
    connectToHost(page("http:", ""), (url) => {
      asked.push(url);
      return openNothing();
    });

    expect(asked).toEqual([]);
  });
});

describe("hasHost", () => {
  it("is true for a page served over http", () => {
    expect(hasHost(page("http:", "127.0.0.1:7777"))).toBeTrue();
  });

  it("is true for a page served over https", () => {
    expect(hasHost(page("https:", "desktop.example"))).toBeTrue();
  });

  // The one case a shell has to get right, and the reason this is not spelled
  // `window.domicileHost === undefined` any more: under the fork there is no
  // injected channel and there very much is a host. A shell asking the old
  // question would take the viewport's geometry and lay its windows out on a
  // desktop nobody described.
  it("is false for a page opened from a file, and only then", () => {
    expect(hasHost(page("file:", ""))).toBeFalse();
  });
});
