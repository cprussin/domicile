#!/usr/bin/env python3
"""The page guard-webview-content-script.sh looks for a content script's mark on.

One path, `/page`: a document in one flat color, and nothing else, so every
pixel of it is either that color or the extension's mark over it. Served from
127.0.0.1, which is what the fixture extension's content script matches.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PAGE_PATH = "/page"

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page for a content script</title>
    <style>
      html,
      body {{
        background: #{color};
        block-size: 100%;
        inline-size: 100%;
        margin: 0;
        padding: 0;
      }}
    </style>
  </head>
  <body></body>
</html>
"""


class OnePage(BaseHTTPRequestHandler):
    """Answers `/page`, and everything else with a 404."""

    # Set by main(): BaseHTTPRequestHandler is instantiated per request.
    color = "000000"

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if urlsplit(self.path).path == PAGE_PATH:
            body = PAGE.format(color=self.color).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            # So no leg is answered out of another's HTTP cache.
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404, "this server has one page and that is not it")

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps: whether the page was requested at
        # all tells "the guest never asked" from "it loaded, unmarked".
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--port",
        type=int,
        required=True,
        help="0 for any free one; the serving line names the one taken",
    )
    parser.add_argument(
        "--color",
        required=True,
        help="RRGGBB, no leading #; the page's own flat color",
    )
    arguments = parser.parse_args()

    OnePage.color = arguments.color
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), OnePage)
    # Before serve_forever, so a guard waiting on this line is not waiting on a
    # buffer. lib-ports.sh's served_port reads the port off it.
    print("serving %s on 127.0.0.1:%d" % (PAGE_PATH, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
