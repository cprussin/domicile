#!/usr/bin/env python3
"""Serves the pages guard-webview-resend-form.sh loads.

  /form    a form that posts itself to /posted as it loads.
  /posted  takes the post, prints `posted <n>` with how many it has taken,
           and answers a page that logs `GUARD posted-loaded`.

Served over HTTP because `crux` cannot reach arbitrary hosts.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FORM = "/form"
POSTED = "/posted"

FORM_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a form for the resend form guard</title>
  </head>
  <body>
    <form method="post" action="/posted">
      <input name="order" value="one coffee" />
    </form>
    <script>
      document.forms[0].submit();
    </script>
  </body>
</html>
"""

POSTED_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Order placed</title>
  </head>
  <body>
    <script>
      console.log("GUARD posted-loaded");
    </script>
  </body>
</html>
"""


class TwoPages(BaseHTTPRequestHandler):
    """Answers the paths above, and everything else with a 404."""

    posts = 0

    def answer(self, page):
        encoded = page.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        # Flushed, since the guard reads it while this server runs.
        print("asked-for %s" % self.path, flush=True)
        if self.path == FORM:
            self.answer(FORM_PAGE)
        else:
            self.send_error(404, "this server has one page to get and that is not it")

    def do_POST(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        if self.path == POSTED:
            TwoPages.posts += 1
            print("posted %d" % TwoPages.posts, flush=True)
            self.answer(POSTED_PAGE)
        else:
            self.send_error(404, "this server takes posts at %s only" % POSTED)

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
    # Threading, but the count is read and written under the GIL by one
    # request at a time: the page posts once per load.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), TwoPages)
    # Flushed before serve_forever, since the guard waits for this line.
    print(
        "serving %s and %s on 127.0.0.1:%d"
        % (FORM, POSTED, server.server_address[1]),
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
