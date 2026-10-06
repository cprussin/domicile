#!/usr/bin/env python3
"""Serves the page that webview guards show in a window.

Served on loopback because crux cannot reach outside hosts.

The page logs to the console, which the engine writes to its log:

  GUARD guest-loaded             a guest was created, attached and navigated
  GUARD guest-keydown code=…     a key reached the page
  GUARD guest-mousedown x=… y=…  a press reached the page, at these coordinates
  GUARD guest-window-focus       the page's window took focus
  GUARD guest-resized width=…    the page's CSS width changed, as on zoom

guest-loaded, guest-mousedown and guest-resized are asserted. guest-keydown
and guest-window-focus are diagnostics only: a headless window may get no key
or focus events. A press is routed by hit test, not focus, so guest-mousedown
arrives either way.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Not "/", so a stray request gets a 404.
PATH = "/page"

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page in a browser window</title>
  </head>
  <body>
    <script>
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };

      // `keydown` on the window, so this hears the key wherever in the page it
      // was delivered. `code` rather than `key`, because the guard drives a
      // physical key and evdev is what the desktop's claims are written in.
      addEventListener("keydown", (event) => {
        say(`guest-keydown code=${event.code} alt=${event.altKey}`);
      });

      // And the press, with where in this page it landed. The coordinates are
      // the reading that says the hit test crossed into the guest rather than
      // stopping at the element: they are this page's, and the guard drove the
      // press at the browser window's.
      addEventListener("mousedown", (event) => {
        say(`guest-mousedown x=${event.clientX} y=${event.clientY}`);
      });

      // Whether the press moved focus INTO this page, asked here because it is
      // the only place that can answer it. The click guard's whole question is
      // what a shell outside is told when that happens; a run where it never
      // happened is asking nothing.
      addEventListener("focus", () => {
        say("guest-window-focus");
      });

      // The page's own width in CSS pixels, whenever it changes. Zooming a page
      // is what changes it with the window standing still, which is how the
      // keyboard guard tells a zoom the page drew from one the element only
      // reported.
      addEventListener("resize", () => {
        say(`guest-resized width=${innerWidth}`);
      });

      say("guest-loaded");
    </script>
  </body>
</html>
"""


class ShowsWhatItWasGiven(BaseHTTPRequestHandler):
    """Answers PATH with the page, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path != PATH:
            self.send_error(404, "this server has one page and it is " + PATH)
            return

        body = PAGE.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # So one run is not served from another's HTTP cache.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Logged so a failure shows whether the guest requested the page.
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--port",
        type=int,
        required=True,
        help="0 for any free one; the serving line names the one taken",
    )
    arguments = parser.parse_args()

    # Loopback only: nothing off this machine should reach a test fixture.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), ShowsWhatItWasGiven)
    # Flushed before serve_forever, because guards wait on this line.
    print("serving %s on 127.0.0.1:%d" % (PATH, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
