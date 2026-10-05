#!/usr/bin/env python3
"""The page guard-webview-survives-load-shell.sh keeps in a browser window.

The page picks a token on load, logs it once, then ticks with it every quarter
second. A page that survives `domicile load-shell` keeps ticking with its
token. A reloaded page logs `page-loaded` again with a new token.

It logs two lines to the console, which the engine writes to its log:

  GUARD page-loaded token=…      the page ran, with the token it picked
  GUARD tick token=… n=…         it is still running, after n ticks

Served over HTTP, not as a `data:` URL, for guard-webview-guest-page.py's
reason: `crux` reaches no arbitrary host, and a bundled fixture cannot change
under the guard.
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
    <title>a page that outlives its shell</title>
  </head>
  <body>
    <script>
      const token = Math.random().toString(36).slice(2);
      console.log(`GUARD page-loaded token=${token}`);
      let n = 0;
      setInterval(() => {
        n += 1;
        console.log(`GUARD tick token=${token} n=${n}`);
      }, 250);
    </script>
  </body>
</html>
"""


class KeepsTicking(BaseHTTPRequestHandler):
    """Answers PATH with the page, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path != PATH:
            self.send_error(404, "this server has one page and it is " + PATH)
            return

        body = PAGE.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # Forces a reload to hit this server instead of the HTTP cache, which
        # the log would not show.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps. The request count is the server's
        # evidence of a reload.
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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), KeepsTicking)
    print(
        "serving a page that outlives its shell on 127.0.0.1:%d"
        % server.server_address[1],
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
