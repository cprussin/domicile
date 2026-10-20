#!/usr/bin/env python3
"""Serves the pages guard-webview-will-navigate.sh loads.

  /start      sets `location` to /blocked at once, and to /allowed two seconds
              later. The second runs only if the first was canceled, since
              a navigation that goes ahead unloads the page and its timer.
  /blocked, /allowed, /shell-set
              plain pages.

Every request is logged to stderr as `"GET <path> …"`, which the guard reads
to tell a canceled navigation, never requested, from one that went ahead.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

START_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>start</title>
  </head>
  <body>
    <script>
      location.href = "/blocked";
      setTimeout(() => {
        location.href = "/allowed";
      }, 2000);
    </script>
  </body>
</html>
"""

PLAIN_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>%(path)s</title>
  </head>
  <body></body>
</html>
"""

PLAIN = {"/blocked", "/allowed", "/shell-set"}


class Pages(BaseHTTPRequestHandler):
    """Answers the four paths above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        path = urlparse(self.path).path
        if path == "/start":
            body = START_PAGE
        elif path in PLAIN:
            body = PLAIN_PAGE % {"path": path}
        else:
            self.send_error(404, "this server has four paths and that is none of them")
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
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))
        sys.stderr.flush()


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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), Pages)
    # Flushed before serve_forever, since the guard waits for this line.
    print("serving /start on 127.0.0.1:%d" % server.server_address[1], flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
