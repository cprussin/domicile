#!/usr/bin/env python3
"""Three pages for a guest to have a history of, served on loopback.

`guard-webview-history.sh` drives `goBack()`, `goForward()`, `stop()` and
`reload()` at a `<webview>` and reads which page the guest ended up showing.
That needs pages that say which they are, and CI has no route to any: `crux`
reaches no arbitrary host, and a guard whose subject could change under it
fails for reasons nobody chose. So the guard brings its own.

  /one    where the window starts
  /two    where it goes next, so there is a history to move in
  /slow   answered only after --slow-seconds, which is what gives stop()
          something to cancel

Each page says one line to the console, which the engine writes to its own log
and the guard reads as its whole measurement:

  GUARD guest-shown path=/one serial=3 persisted=false

ON `pageshow` RATHER THAN AT PARSE TIME, and that is the difference between
measuring this and measuring nothing: a page restored from the back/forward
cache does not run its script again, so a `console.log` in the body would go
unreported for exactly the navigation the guard exists to assert. `pageshow`
fires for a fresh load and for a restore alike, and says which it was.

THE SERIAL IS PER RESPONSE, so a page can tell one visit from the next. It is
what makes `reload()` readable at all: a reload of the page already showing is
otherwise indistinguishable from nothing happening, and a bfcache restore
carries the serial it was cached with while a reload cannot.

`no-store` for the reason the framing fixture sends it, twice over here: a
back-navigation answered out of the HTTP cache would report the serial it
reported the first time, and a guard reading serials would be reading its own
past.
"""

import argparse
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The three paths this serves, which are also the names
# `guard-webview-history.js` navigates to and the strings the guard's verdict
# compares. Named rather than "/" so a request that arrives by accident is a
# 404 rather than one of the pages the verdict is about.
FAST_PATHS = ("/one", "/two")
SLOW_PATH = "/slow"

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{path}</title>
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

    # Set by main(), because BaseHTTPRequestHandler is instantiated per request
    # and there is nowhere else to put them.
    slow_seconds = 0.0
    # A lock because ThreadingHTTPServer answers `/slow` on a thread of its own
    # and the guard navigates elsewhere while it sleeps.
    lock = threading.Lock()
    served = 0

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        # WHEN IT WAS ASKED FOR, not when it was answered, and that is one of
        # the guard's readings rather than a log line: BaseHTTPRequestHandler
        # logs a request as it sends the response, which for SLOW_PATH is after
        # the wait and after the browser may have given up. "The element never
        # started the navigation" and "stop() cancelled it" read identically
        # from the browser's log, and this is what separates them.
        sys.stderr.write("asked %s\n" % self.path)

        if self.path == SLOW_PATH:
            # Before a single header, which is the whole point: a navigation
            # with no response yet is a navigation `stop()` can cancel, and one
            # that has committed is not.
            time.sleep(self.slow_seconds)
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
        # So a back-navigation is a load and not a replay of the first one's
        # bytes, serial and all.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps -- and one of its readings: whether
        # the slow page was ever REQUESTED is what tells "stop() cancelled the
        # navigation" apart from "the element never started one", which read
        # identically from the browser's log.
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument(
        "--slow-seconds",
        type=float,
        required=True,
        help="how long %s waits before it answers" % SLOW_PATH,
    )
    arguments = parser.parse_args()

    HasAHistory.slow_seconds = arguments.slow_seconds
    # 127.0.0.1, not 0.0.0.0: nothing outside this machine has any business
    # reaching a guard's fixture.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), HasAHistory)
    # Before serve_forever, so a guard waiting on this line is not waiting on a
    # buffer.
    print(
        "serving /one /two /slow on 127.0.0.1:%d, %s after %gs"
        % (arguments.port, SLOW_PATH, arguments.slow_seconds),
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
