#!/usr/bin/env python3
"""Serves the page guard-webview-dialog.sh presses to open a dialog.

  /page     a plain top half and a bottom half that is one button. A press on
            the button calls `prompt("Your name?", "Ada")`; a press on the top
            half opens nothing. Logs `GUARD page-loaded`, `GUARD
            page-mousedown` for each press, which shows a press reached the
            guest, and `GUARD page-prompt value=V` when the prompt returns,
            which shows the shell's answer reached the page.

Served over HTTP because `crux` cannot reach arbitrary hosts.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PAGE = "/page"

# Fixed halves of the viewport, so the guard's computed press points do not
# depend on fonts or margins.
PAGE_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page with a prompt button</title>
    <style>
      html, body { margin: 0; height: 100%; }
      #plain { position: fixed; inset: 0 0 50% 0; background: #204060; }
      #ask { position: fixed; inset: 50% 0 0 0; border: 0; }
    </style>
  </head>
  <body>
    <div id="plain"></div>
    <button id="ask" type="button">ask</button>
    <script>
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };

      addEventListener("mousedown", (event) => {
        say(`page-mousedown x=${event.clientX} y=${event.clientY}`);
      });

      // prompt() blocks the page until the shell answers, then returns its
      // text, or null for Cancel.
      document.getElementById("ask").addEventListener("click", () => {
        say(`page-prompt value=${prompt("Your name?", "Ada")}`);
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
