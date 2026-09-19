// What a browser window can honestly say about the connection behind the page
// it is showing.
//
// THE SCHEME IS THE WHOLE OF THE EVIDENCE, and that is a smaller claim than
// the one Chromium's lock makes. A browser draws its lock from the certificate
// the network stack validated; nothing of that reaches this page. The engine
// reports a guest's history availability and whether it is loading and nothing
// else — see ROADMAP.md — so what a shell has is the address it *sent* the
// window to. Which is why the indicator's details say so in as many words:
// what is drawn is what was asked for, not what came back, and a page that
// followed a link or a redirect has gone somewhere this window was never told
// about.

/** What the scheme of an address says about the connection under it. */
export enum ConnectionSafety {
  /** `https:` — the page was asked for over TLS. */
  Encrypted,
  /** `http:` — the page was asked for in the clear, and anyone on the path can read it. */
  Plain,
  /** A scheme that is not a connection at all: `about:`, `file:`, `domicile:`. */
  Local,
}

/**
 * What the address `url` says about its connection.
 *
 * Throws on an address that will not parse. Every address that reaches here
 * was either made by `typedAddress` or opened by the shell, so one that will
 * not parse is a bug upstream rather than a case to draw an icon for.
 */
export const connectionSafety = (url: string): ConnectionSafety => {
  switch (new URL(url).protocol) {
    case "https:": {
      return ConnectionSafety.Encrypted;
    }
    case "http:": {
      return ConnectionSafety.Plain;
    }
    default: {
      return ConnectionSafety.Local;
    }
  }
};
