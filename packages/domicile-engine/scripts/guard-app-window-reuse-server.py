#!/usr/bin/env python3
"""Serves the pages guard-app-window-reuse.sh opens.

  /mail?n=…   the page the guard opens over the command socket, titled
              `mail <n>`. Reports `loaded mail n=<n>`.
  /chat       the page the shell opens itself, titled `chat`, with three
              `p.item`s for the shell to count.
  /report?line=  prints `GUARD <line>` to stdout, which the guard reads.

Served over HTTP because `crux` cannot reach arbitrary hosts.
"""

import argparse
import html
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

REPORT = "/report"

MAIL = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>mail %(n)s</title>
  </head>
  <body>
    <script>
      fetch("/report?line=loaded%%20mail%%20n=%(quoted)s");
    </script>
  </body>
</html>
"""

CHAT = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>chat</title>
  </head>
  <body>
    <p class="item">one</p>
    <p class="item">two</p>
    <p class="item">three</p>
    <p>not an item</p>
  </body>
</html>
"""


class Pages(BaseHTTPRequestHandler):
    """Answers the paths above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        url = urlparse(self.path)
        query = parse_qs(url.query)
        if url.path == REPORT:
            print("GUARD %s" % query.get("line", [""])[0], flush=True)
            body = ""
        elif url.path == "/mail":
            n = query.get("n", [""])[0]
            body = MAIL % {"n": html.escape(n), "quoted": quote(n)}
        elif url.path == "/chat":
            body = CHAT
        else:
            self.send_error(404, "this server has three paths and that is none of them")
            return

        encoded = body.encode("utf-8")
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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), Pages)
    # Flushed before serve_forever, since the guard waits for this line.
    print("serving /mail on 127.0.0.1:%d" % server.server_address[1], flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
