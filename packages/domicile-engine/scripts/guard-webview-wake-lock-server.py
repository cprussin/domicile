#!/usr/bin/env python3
"""Serves the pages guard-webview-wake-lock.sh loads in a browser window.

  /page     takes a screen wake lock as it loads, and releases it 3 seconds
            after it holds. Logs `GUARD page-loaded`, `GUARD page-wake-lock
            held` once `navigator.wakeLock.request()` resolves, `GUARD
            page-wake-lock released` once it lets go, and `GUARD page-wake-lock
            refused <error>` if the request fails.
  /plain    the control: logs `GUARD page-loaded` and asks for nothing.

Served over HTTP on loopback, which is a secure context, because `crux`
cannot reach arbitrary hosts.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOCKING_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page that keeps the screens on</title>
  </head>
  <body>
    <script>
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };

      navigator.wakeLock.request("screen").then(
        (sentinel) => {
          sentinel.addEventListener("release", () => {
            say("page-wake-lock released");
          });
          say("page-wake-lock held");
          setTimeout(() => {
            sentinel.release();
          }, 3000);
        },
        (error) => {
          say(`page-wake-lock refused ${error}`);
        },
      );

      say("page-loaded");
    </script>
  </body>
</html>
"""

PLAIN_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page that asks for nothing</title>
  </head>
  <body>
    <script>
      console.log("GUARD page-loaded");
    </script>
  </body>
</html>
"""

PAGES = {"/page": LOCKING_HTML, "/plain": PLAIN_HTML}


class TwoPages(BaseHTTPRequestHandler):
    """Answers the paths above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        page = PAGES.get(self.path)
        if page is None:
            self.send_error(404, "this server has two pages and that is neither")
            return

        encoded = page.encode("utf-8")
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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), TwoPages)
    # Flushed before serve_forever, since the guard waits for this line.
    print(
        "serving %s on 127.0.0.1:%d" % (" ".join(PAGES), server.server_address[1]),
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
