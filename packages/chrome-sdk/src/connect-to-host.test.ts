import { describe, expect, it } from "bun:test";

import type { HostWindow } from "./connect-to-host";
import { connectToHost } from "./connect-to-host";
import type { WebSocketLike } from "./websocket-transport";

const openNothing = (): WebSocketLike => ({
  addEventListener: () => undefined,
  readyState: 1,
  send: () => undefined,
});

const page = (
  protocol: string,
  host: string,
  domicileHost?: HostWindow["domicileHost"],
): HostWindow => ({
  addEventListener: () => undefined,
  domicileHost,
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

  // Electron injects a channel, and a fork-shaped guess would open a socket to
  // nothing. The injected one wins whatever the page was served over.
  it("prefers a channel a preload injected", () => {
    const asked: string[] = [];
    const sent: string[] = [];
    const transport = connectToHost(
      page("http:", "127.0.0.1:7777", {
        listen: () => undefined,
        send: (text) => sent.push(text),
      }),
      (url) => {
        asked.push(url);
        return openNothing();
      },
    );
    transport.send('{"type":"hello"}');

    expect(asked).toEqual([]);
    expect(sent).toEqual(['{"type":"hello"}']);
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
