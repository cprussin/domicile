#!/usr/bin/env python3
"""The pages guard-webview-tooltip.sh hovers.

  /page    the page in the browser window. Nothing on it has a title. It holds
           one iframe, at 200,150 and 400x300, loaded from `localhost` so it
           is another site and so another process: its own render widget,
           with its own coordinates, as an extension's or a challenge's frame
           is. Says `GUARD page-loaded` once the frame has loaded.

  /frame   that frame: one block filling it, titled `in a frame`.

Served over HTTP for the reason guard-webview-framing-server.py serves its
own subject: `crux` reaches no arbitrary host.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PAGE = "/page"
FRAME = "/frame"

PAGE_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a titled frame</title>
    <style>
      html, body { margin: 0; height: 100%%; }
      iframe {
        position: fixed;
        left: 200px;
        top: 150px;
        width: 400px;
        height: 300px;
        border: 0;
      }
    </style>
  </head>
  <body>
    <iframe src="%(frame)s"></iframe>
    <script>
      document.querySelector("iframe").addEventListener("load", () => {
        console.log("GUARD page-loaded");
      });
    </script>
  </body>
</html>
"""

FRAME_HTML = b"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      html, body, div { margin: 0; height: 100%; }
    </style>
  </head>
  <body><div title="in a frame"></div></body>
</html>
"""


class TitledFrame(BaseHTTPRequestHandler):
    """Answers the two paths above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        path = urlsplit(self.path).path
        if path == PAGE:
            frame = "http://localhost:%d%s" % (self.server.server_address[1], FRAME)
            self.answer((PAGE_HTML % {"frame": frame}).encode("utf-8"))
        elif path == FRAME:
            self.answer(FRAME_HTML)
        else:
            self.send_error(404, "this server has two pages and that is neither")

    def answer(self, body):
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
    parser.add_argument(
        "--port",
        type=int,
        required=True,
        help="0 for any free one; the serving line names the one taken",
    )
    arguments = parser.parse_args()

    # Loopback only: nothing off this machine should reach a test fixture.
    # `localhost` still reaches it.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), TitledFrame)
    # Flushed before serve_forever, because guards wait on this line.
    print("serving %s %s on 127.0.0.1:%d" % (PAGE, FRAME, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
