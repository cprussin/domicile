#!/usr/bin/env python3
"""Serves a flat-colored page at `/page` for content script guards.

Served from 127.0.0.1, which the fixture extension's content script matches.

The page reloads every second. A content script only runs on documents loaded
after its extension, and the extension can load after the first page.

`--still` disables the reload, for guards whose mark a reload would erase
(guard-webview-active-tab.sh). The page then moves to `#ready` once loaded, so
the guard waits for a committed page rather than a pending `url`.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PAGE_PATH = "/page"

REFRESH = """    <meta http-equiv="refresh" content="1" />
"""

READY = """    <script>
      addEventListener("load", () => {
        history.replaceState(null, "", "#ready");
      });
    </script>
"""

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
{refresh}{ready}    <title>a page for a content script</title>
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
    refresh = REFRESH
    ready = ""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if urlsplit(self.path).path == PAGE_PATH:
            body = PAGE.format(
                color=self.color, refresh=self.refresh, ready=self.ready
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            # So one run is not served from another's HTTP cache.
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404, "this server has one page and that is not it")

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
    parser.add_argument(
        "--color",
        required=True,
        help="RRGGBB, no leading #; the page's own flat color",
    )
    parser.add_argument(
        "--still",
        action="store_true",
        help="serve the page without reloading itself every second, and"
        " saying it is up by moving to #ready once it has loaded",
    )
    arguments = parser.parse_args()

    OnePage.color = arguments.color
    OnePage.refresh = "" if arguments.still else REFRESH
    OnePage.ready = READY if arguments.still else ""
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), OnePage)
    # Flushed before serve_forever: guards wait on this line, and lib-ports.sh's
    # served_port reads the port from it.
    print("serving %s on 127.0.0.1:%d" % (PAGE_PATH, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
