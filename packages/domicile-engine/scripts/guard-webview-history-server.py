#!/usr/bin/env python3
"""Serves /one, /two and /slow for guard-webview-history.sh.

  /one    where the window starts
  /two    where it goes next
  /slow   answers after --slow-seconds, or never if the browser hangs up

- Pages log `GUARD guest-shown path=… serial=… persisted=…` on `pageshow`, so
  a bfcache restore is reported too.
- The serial is per response, so a reload is distinguishable from no change
  and from a bfcache restore.
"""

import argparse
import select
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Not "/", so a stray request gets a 404.
FAST_PATHS = ("/one", "/two")
SLOW_PATH = "/slow"

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{path}</title>
    <!-- What the element's `favicon` must name: never fetched, because the
         browser reports the icon a page links rather than one it loaded. -->
    <link rel="icon" href="{path}.png" />
  </head>
  <body>
    <script>
      // `pageshow` and not the top of the script: a page restored from the
      // back/forward cache runs no script again, and that restore is one of
      // the navigations under test.
      addEventListener("pageshow", (event) => {{
        console.log(
          `GUARD guest-shown path={path} serial={serial}` +
            ` persisted=${{event.persisted}}`,
        );
      }});
    </script>
  </body>
</html>
"""


class HasAHistory(BaseHTTPRequestHandler):
    """Answers the three paths, and everything else with a 404."""

    # Set by main(): BaseHTTPRequestHandler is instantiated per request.
    slow_seconds = 0.0
    # ThreadingHTTPServer answers /slow on its own thread while other requests
    # arrive.
    lock = threading.Lock()
    served = 0

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        # Logged on arrival, not on response: BaseHTTPRequestHandler logs
        # after the wait. Tells "stop() canceled it" from "never started".
        sys.stderr.write("asked %s\n" % self.path)

        if self.path == SLOW_PATH:
            # Before any header: stop() can cancel only an uncommitted
            # navigation. A readable socket means the browser hung up; log it
            # now.
            hung_up, _, _ = select.select(
                [self.connection], [], [], self.slow_seconds
            )
            if hung_up:
                sys.stderr.write("abandoned %s\n" % self.path)
                return
        elif self.path not in FAST_PATHS:
            self.send_error(404, "this server has three pages: /one /two /slow")
            return

        with HasAHistory.lock:
            HasAHistory.served += 1
            serial = HasAHistory.served

        body = PAGE.format(path=self.path, serial=serial).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # So a back-navigation reloads rather than replaying cached bytes.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Logged so the guard can tell "stop() canceled /slow" from "never
        # requested".
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
        "--slow-seconds",
        type=float,
        required=True,
        help="how long %s waits before it answers" % SLOW_PATH,
    )
    arguments = parser.parse_args()

    HasAHistory.slow_seconds = arguments.slow_seconds
    # Loopback only: nothing off this machine should reach a test fixture.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), HasAHistory)
    # Flushed before serve_forever, because guards wait on this line.
    print(
        "serving /one /two /slow on 127.0.0.1:%d, %s after %gs"
        % (server.server_address[1], SLOW_PATH, arguments.slow_seconds),
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
