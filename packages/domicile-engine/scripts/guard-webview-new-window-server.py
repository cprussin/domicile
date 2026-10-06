#!/usr/bin/env python3
"""Serves the pages guard-webview-new-window.sh clicks through.

  /opener   the page in the browser window: two links, each filling half of it.
            The top half is target="_blank" -> /opened, the subject. The bottom
            half is an ordinary link -> /stayed, the control. Half-page targets
            cannot be missed by rounding in the guard's computed click point.
            Logs `GUARD opener-loaded`, and `GUARD guest-mousedown` for each
            press, which shows the click reached the guest.
  /opened   logs `GUARD opened-loaded`. Only a second <webview> opened by the
            shell loads it, so this shows the user got a window.
  /stayed   logs `GUARD stayed-loaded`. Shows the control's click followed a
            link, so its lack of a new window is a real result.

Separate from guard-webview-guest-page.py so other guards' clicks do not depend
on this layout. Served over HTTP because `crux` cannot reach arbitrary hosts,
and the request log shows which pages were requested.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OPENER = "/opener"
OPENED = "/opened"
STAYED = "/stayed"

# Fixed-position halves, so link positions depend only on the window size, not
# on fonts or margins.
OPENER_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page that wants another window</title>
    <style>
      html, body { margin: 0; height: 100%%; }
      a { display: block; position: fixed; inset-inline: 0; height: 50%%; }
      #blank { inset-block-start: 0; background: #204060; }
      #same { inset-block-end: 0; background: #402060; }
    </style>
  </head>
  <body>
    <a id="blank" href="%(opened)s" target="_blank">open a window</a>
    <a id="same" href="%(stayed)s">stay in this one</a>
    <script>
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };

      // Where the press landed, in this page's own coordinates. The reading
      // that says the hit test crossed into the guest rather than stopping at
      // the element around it -- the guard drove the press at the browser
      // window's coordinates, and these are the page's.
      addEventListener("mousedown", (event) => {
        say(`guest-mousedown x=${event.clientX} y=${event.clientY}`);
      });

      say("opener-loaded");
    </script>
  </body>
</html>
"""

# The pages the links lead to. Each logs which one it is.
ARRIVED_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>%(which)s</title>
  </head>
  <body>
    <script>
      console.log("GUARD %(which)s-loaded");
    </script>
  </body>
</html>
"""


class TwoLinksAndWhereTheyGo(BaseHTTPRequestHandler):
    """Answers the three paths above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path == OPENER:
            body = OPENER_PAGE % {"opened": OPENED, "stayed": STAYED}
        elif self.path == OPENED:
            body = ARRIVED_PAGE % {"which": "opened"}
        elif self.path == STAYED:
            body = ARRIVED_PAGE % {"which": "stayed"}
        else:
            self.send_error(404, "this server has three pages and that is none of them")
            return

        encoded = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        # So a run is never served a cached page from an earlier run.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps: a request for /opened shows the
        # second <webview> was made and navigated.
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

    # Loopback only: nothing outside this machine should reach the fixture.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), TwoLinksAndWhereTheyGo)
    # Flushed before serve_forever, since the guard waits for this line.
    print("serving %s on 127.0.0.1:%d" % (OPENER, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
