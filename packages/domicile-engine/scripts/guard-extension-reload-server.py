#!/usr/bin/env python3
"""The page guard-extension-reload.sh shows in two profiles, at two hosts.

The page logs which host it is at and the mark the fixture's content script
left on it. The script runs at `document_start`, before the page's own, so the
mark is there when the extension is. It logs to the console, which the engine
writes to its log:

  GUARD extension=EDIT at=HOST       a page at HOST with edit EDIT, or `none`

Served over HTTP for guard-webview-guest-page.py's reason: `crux` reaches no
arbitrary host, and a bundled fixture cannot change under the guard. The guard
reaches it as 127.0.0.1, which no site names, and as localhost, which the
config's sites put in another profile.
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
    <title>a page that says which edit of an extension it has</title>
  </head>
  <body>
    <script>
      const edit = document.documentElement.dataset.extension ?? "none";
      console.log(`GUARD extension=${edit} at=${location.hostname}`);
    </script>
  </body>
</html>
"""


class SaysItsExtension(BaseHTTPRequestHandler):
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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), SaysItsExtension)
    print(
        "serving a page that says which edit of an extension it has on "
        "127.0.0.1:%d" % server.server_address[1],
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
