#!/usr/bin/env python3
"""The page guard-webview-permissions.sh shows in a browser window.

  /camera   asks for the camera with getUserMedia as soon as it loads. Says
            `GUARD page-loaded` first, then `GUARD page-granted tracks=N` when
            the stream arrives or `GUARD page-refused name=NAME` when it is
            refused.

Served over HTTP on 127.0.0.1, which is a secure context, for the reason
guard-webview-framing-server.py serves its own subject: `crux` reaches no
arbitrary host.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PAGE = "/camera"

PAGE_HTML = b"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>asks for the camera</title>
  </head>
  <body>
    <script>
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };
      say("page-loaded");
      navigator.mediaDevices.getUserMedia({ video: true }).then(
        (stream) => {
          say(`page-granted tracks=${stream.getVideoTracks().length}`);
        },
        (error) => {
          say(`page-refused name=${error.name}`);
        },
      );
    </script>
  </body>
</html>
"""


class AsksForTheCamera(BaseHTTPRequestHandler):
    """Answers the page above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if urlsplit(self.path).path == PAGE:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(PAGE_HTML)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(PAGE_HTML)
        else:
            self.send_error(404, "this server has one page and that is not it")

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

    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), AsksForTheCamera)
    print("serving %s on 127.0.0.1:%d" % (PAGE, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
