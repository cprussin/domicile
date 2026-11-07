#!/usr/bin/env python3
"""Serves the pages guard-webview-page-failure.sh loads, two of which fail.

  /empty-500  answers 500 with no body, which Chrome would show its "This
              page isn't working" page for.
  /drop       closes the connection without answering: ERR_EMPTY_RESPONSE,
              which Chrome would show its error page for.
  /ok         a page that logs `GUARD ok-loaded`.

Served over HTTP because `crux` cannot reach arbitrary hosts.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

EMPTY_500 = "/empty-500"
DROP = "/drop"
OK = "/ok"

OK_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page for the page failure guard</title>
  </head>
  <body>
    <script>
      console.log("GUARD ok-loaded");
    </script>
  </body>
</html>
"""


class ThreePages(BaseHTTPRequestHandler):
    """Answers the paths above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        # Flushed, since the guard reads it while this server runs.
        print("asked-for %s" % self.path, flush=True)
        if self.path == EMPTY_500:
            self.send_response(500)
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
        elif self.path == DROP:
            # No status line at all; the browser sees an empty response.
            self.close_connection = True
        elif self.path == OK:
            encoded = OK_PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(encoded)
        else:
            self.send_error(404, "this server has three pages and that is not one")

    def log_message(self, fmt, *args):
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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), ThreePages)
    # Flushed before serve_forever, since the guard waits for this line.
    print(
        "serving %s, %s and %s on 127.0.0.1:%d"
        % (EMPTY_500, DROP, OK, server.server_address[1]),
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
