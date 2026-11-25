#!/usr/bin/env python3
"""Serve the page guard-agent-input-keeps-focus.sh opens in a browser window.

One text field filling the page, so a press anywhere lands in it. The page
logs, as console lines the engine writes to its log:

  GUARD guest-loaded           the page ran
  GUARD guest-mousedown        a press reached the page
  GUARD guest-field-focus      the field took focus, with focus events: the
                               page has page focus of its own
  GUARD guest-input value=…    the field's value, after each input to it

Prints "serving /page on 127.0.0.1:N" once it listens, which served_port reads.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PATH = "/page"

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>an agent's browser window</title>
    <style>
      html, body { margin: 0; block-size: 100%; }
      input { box-sizing: border-box; inline-size: 100%; block-size: 100%; }
    </style>
  </head>
  <body>
    <input id="field" aria-label="the agent's field" />
    <script>
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };
      const field = document.getElementById("field");
      addEventListener("mousedown", () => {
        say("guest-mousedown");
      });
      field.addEventListener("focus", () => {
        say("guest-field-focus");
      });
      field.addEventListener("input", () => {
        say(`guest-input value=${field.value}`);
      });
      say("guest-loaded");
    </script>
  </body>
</html>
"""


class OnePage(BaseHTTPRequestHandler):
    """Answers PATH with the page, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path != PATH:
            self.send_error(404, "this server has one page and it is " + PATH)
            return
        body = PAGE.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True,
                        help="0 for any free one; the serving line names it")
    arguments = parser.parse_args()
    # Loopback only: nothing off this machine should reach a test fixture.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), OnePage)
    print("serving %s on 127.0.0.1:%d" % (PATH, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
