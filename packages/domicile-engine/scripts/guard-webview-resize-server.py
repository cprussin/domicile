#!/usr/bin/env python3
"""Serves the page guard-webview-resize.sh shows in a browser window.

Served on loopback because crux cannot reach outside hosts.

The page fills its window with one color and picks a random one on every press,
so a screenshot tells a page that draws from a frame left on screen, even one
the page drew before it was loaded again. It logs to the
console, which the engine writes to its log:

  GUARD guest-loaded                    the page loaded
  GUARD guest-size width=… height=…     the page's viewport, on load and on
                                        every resize
  GUARD guest-painted color=…           a press reached the page and it chose
                                        this color, as `#rrggbb`
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
    <title>a page a resize must not freeze</title>
    <style>
      html, body { margin: 0; block-size: 100%; }
    </style>
  </head>
  <body>
    <script>
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };

      // Random, so no earlier frame, from this load or one before it, has it.
      // Opaque, so software compositing keeps it exact.
      const randomColor = () =>
        `#${Math.floor(Math.random() * 0x1000000)
          .toString(16)
          .padStart(6, "0")}`;

      const paint = (color) => {
        document.body.style.background = color;
      };

      addEventListener("mousedown", () => {
        const color = randomColor();
        paint(color);
        say(`guest-painted color=${color}`);
      });

      const report = () => {
        say(`guest-size width=${innerWidth} height=${innerHeight}`);
      };
      addEventListener("resize", report);

      paint("#ffffff");
      report();
      say("guest-loaded");
    </script>
  </body>
</html>
"""


class ShowsThePage(BaseHTTPRequestHandler):
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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), ShowsThePage)
    # Flushed before serve_forever, because guards wait on this line.
    print("serving %s on 127.0.0.1:%d" % (PATH, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
