#!/usr/bin/env python3
"""Serves the pages guard-webview-private.sh loads.

  /set           sets the cookie `seen=1` in its response headers, so the
                 cookie is stored before the page commits. Reports `set-loaded`.
  /read?as=NAME  reports `read as=NAME cookie=…`, with the page's
                 `document.cookie`, or `(none)` when it has none.
  /report?line=  prints `GUARD <line>` to stdout, which the guard reads.

Pages report here, not to the console: content does not log an
off-the-record page's console messages (RenderFrameHostImpl::
DidAddMessageToConsole), so a private page's console says nothing.

Served over HTTP because `crux` cannot reach arbitrary hosts, and the request
log shows which pages were requested.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

SET = "/set"
READ = "/read"
REPORT = "/report"

SET_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>set</title>
  </head>
  <body>
    <script>
      fetch("/report?line=set-loaded");
    </script>
  </body>
</html>
"""

READ_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>read</title>
  </head>
  <body>
    <script>
      const line = `read as=%(name)s cookie=${document.cookie || "(none)"}`;
      fetch(`/report?line=${encodeURIComponent(line)}`);
    </script>
  </body>
</html>
"""


class SetAndRead(BaseHTTPRequestHandler):
    """Answers the three paths above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        url = urlparse(self.path)
        cookie = None
        if url.path == SET:
            body = SET_PAGE
            cookie = "seen=1; Max-Age=3600; Path=/"
        elif url.path == REPORT:
            line = parse_qs(url.query).get("line", [""])[0]
            print("GUARD %s" % line, flush=True)
            body = ""
        elif url.path == READ:
            # Only letters, so the name cannot break out of the page's string.
            name = "".join(c for c in parse_qs(url.query).get("as", [""])[0] if c.isalpha())
            body = READ_PAGE % {"name": name}
        else:
            self.send_error(404, "this server has three paths and that is none of them")
            return

        encoded = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        # So a run is never served a cached page from an earlier run.
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), SetAndRead)
    # Flushed before serve_forever, since the guard waits for this line.
    print("serving %s on 127.0.0.1:%d" % (SET, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
