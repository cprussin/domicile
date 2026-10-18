#!/usr/bin/env python3
"""Serves the page guard-webview-print.sh prints.

  /page     logs `GUARD page-loaded`, then `GUARD page-beforeprint N` and
            `GUARD page-afterprint N` around each print, numbered from 1. After
            the first print ends, it prints itself with `window.print()`, so
            the second print is the page's own.

Served over HTTP because `crux` cannot reach arbitrary hosts.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PAGE = "/page"

PAGE_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page to print</title>
  </head>
  <body>
    <p>A page to print.</p>
    <script>
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };

      let prints = 0;
      addEventListener("beforeprint", () => {
        prints += 1;
        say(`page-beforeprint ${prints}`);
      });
      // A timeout, so the second print starts after the first has returned.
      addEventListener("afterprint", () => {
        say(`page-afterprint ${prints}`);
        if (prints === 1) {
          setTimeout(() => {
            window.print();
          }, 500);
        }
      });

      say("page-loaded");
    </script>
  </body>
</html>
"""


class OnePage(BaseHTTPRequestHandler):
    """Answers the path above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path != PAGE:
            self.send_error(404, "this server has one page and that is not it")
            return

        encoded = PAGE_HTML.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        # So a run is never served a cached page from an earlier run.
        self.send_header("Cache-Control", "no-store")
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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), OnePage)
    # Flushed before serve_forever, since the guard waits for this line.
    print("serving %s on 127.0.0.1:%d" % (PAGE, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
