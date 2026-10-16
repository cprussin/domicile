#!/usr/bin/env python3
"""The page guard-webview-crash.sh shows in a <webview>.

A green page that logs each load to the console, which the engine writes to
its log:

  GUARD page-loaded    the page ran: once on load, once more per reload

Served over HTTP, not as a `data:` URL, for guard-webview-guest-page.py's
reason: `crux` reaches no arbitrary host, and a bundled fixture cannot change
under the guard. An http page also gets a renderer of its own, so crashing it
leaves the shell's running.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The only path served. Not "/", so a stray request gets a 404 instead of the
# page under test.
PATH = "/page"

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a green page</title>
    <style>
      html { background: #00ff00; block-size: 100%; }
    </style>
  </head>
  <body>
    <script>
      console.log("GUARD page-loaded");
    </script>
  </body>
</html>
"""


class GreenPage(BaseHTTPRequestHandler):
    """Answers PATH with the page, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path != PATH:
            self.send_error(404, "this server has one page and it is " + PATH)
            return

        body = PAGE.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # A reload must run the page again, so it logs again.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps.
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

    # 127.0.0.1, not 0.0.0.0: nothing off this machine should reach a guard's
    # fixture.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), GreenPage)
    print(
        "serving a green page on 127.0.0.1:%d" % server.server_address[1],
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
