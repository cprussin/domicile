#!/usr/bin/env python3
"""Serves the pages guard-webview-app-window.sh opens.

  /subject       the page opened as an app window (as an ordinary one in the
                 control). Reports `loaded as=subject`.
  /sentinel      the page opened as an ordinary window after it. Reports
                 `loaded as=sentinel`.
  /launched      the page the shell opens itself with openAppWindow. Reports
                 `loaded as=launched`.
  /report?line=  prints `GUARD <line>` to stdout, which the guard reads. The
                 guard's extension reports the history here too.

Served over HTTP because `crux` cannot reach arbitrary hosts, and the request
log shows which pages were requested.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PAGES = ("/subject", "/sentinel", "/launched")
REPORT = "/report"

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>%(name)s</title>
  </head>
  <body>
    <script>
      fetch("/report?line=loaded%%20as=%(name)s");
    </script>
  </body>
</html>
"""


class Pages(BaseHTTPRequestHandler):
    """Answers the paths above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        url = urlparse(self.path)
        if url.path == REPORT:
            line = parse_qs(url.query).get("line", [""])[0]
            print("GUARD %s" % line, flush=True)
            body = ""
        elif url.path in PAGES:
            body = PAGE % {"name": url.path[1:]}
        else:
            self.send_error(404, "this server has four paths and that is none of them")
            return

        encoded = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        # So a run is never served a cached page from an earlier run.
        self.send_header("Cache-Control", "no-store")
        # The extension's report is a cross-origin fetch from its worker.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(encoded)

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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), Pages)
    # Flushed before serve_forever, since the guard waits for this line.
    print("serving %s on 127.0.0.1:%d" % (PAGES[0], server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
