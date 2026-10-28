#!/usr/bin/env python3
"""The page guard-webview-paused.sh shows in a browser window.

The page opens a `confirm()` the first time its window narrows, so the shell
decides when the page pauses. The shell never answers, so the page stays
paused for the rest of the run.

It logs to the console, which the engine writes to its log:

  GUARD page-loaded      the page ran
  GUARD page-confirm     it is about to open the confirm()
  GUARD page-answered    the confirm() returned, which the shell never allows

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

# A gradient, so every frame of the page has something to draw.
PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page that pauses on a dialog</title>
  </head>
  <body style="margin: 0; background: linear-gradient(90deg, red, blue)">
    <script>
      console.log("GUARD page-loaded");
      // Load can resize the page as it grows into its box, so only a
      // narrower page pauses.
      let widest = innerWidth;
      const pauseWhenNarrowed = () => {
        if (innerWidth >= widest) {
          widest = innerWidth;
        } else {
          removeEventListener("resize", pauseWhenNarrowed);
          console.log("GUARD page-confirm");
          confirm("Pause here?");
          console.log("GUARD page-answered");
        }
      };
      addEventListener("resize", pauseWhenNarrowed);
    </script>
  </body>
</html>
"""


class PausesOnResize(BaseHTTPRequestHandler):
    """Answers PATH with the page, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path != PATH:
            self.send_error(404, "this server has one page and it is " + PATH)
            return

        body = PAGE.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), PausesOnResize)
    print(
        "serving a page that pauses on a dialog on 127.0.0.1:%d"
        % server.server_address[1],
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
