#!/usr/bin/env python3
"""Serves the pages guard-webview-routed-link.sh middle-clicks through.

The link is ordinary on purpose: the mouse button is what is under test. A
middle click asks for the link in a new window, which reaches
`WebContentsDelegate::OpenURLFromTab` with a new-window disposition. Content's
default implementation returns null and does nothing.

  /page     one link to /opened, filling the viewport so the guard's computed
            click point cannot miss. Logs `GUARD page-loaded`, and
            `GUARD page-mousedown` for each press, which shows the click
            reached the guest.
  /opened   the link's target. The middle-click run must not load it: the
            shell opens that window, and the guard reads the shell's event
            instead. The control left-clicks the same link, so it must load
            in place, which shows the press hit the link.

Served over HTTP because `crux` cannot reach arbitrary hosts.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PAGE = "/page"
OPENED = "/opened"

# One link, fixed to the full viewport, so its position does not depend on
# fonts or margins.
PAGE_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page with one link</title>
    <style>
      html, body { margin: 0; height: 100%%; }
      a { display: block; position: fixed; inset: 0; background: #204060; }
    </style>
  </head>
  <body>
    <a id="link" href="%(opened)s">open me somewhere</a>
    <script>
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };

      // Where the press landed, in this document's own coordinates. The
      // reading that says the hit test crossed into the guest rather than
      // stopping at the chrome around it -- the guard drove the press at the
      // browser window's coordinates, and these are this page's.
      //
      // `mousedown` fires for every button, which is what this has to see: the
      // run presses the middle one and the control the left one, and a run
      // where neither reached the page at all must not read like a run where
      // one did and nothing came of it.
      addEventListener("mousedown", (event) => {
        say(`page-mousedown button=${event.button} x=${event.clientX} y=${event.clientY}`);
      });

      say("page-loaded");
    </script>
  </body>
</html>
"""

# The link's target. It logs whether it is the top frame, to tell a load that
# replaced the guest's document from one in some other frame.
OPENED_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>opened</title>
  </head>
  <body>
    <script>
      console.log(
        window.top === window
          ? "GUARD opened-loaded top"
          : "GUARD opened-loaded framed",
      );
    </script>
  </body>
</html>
"""


class OneLink(BaseHTTPRequestHandler):
    """Answers the two paths above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path == PAGE:
            body = PAGE_HTML % {"opened": OPENED}
        elif self.path == OPENED:
            body = OPENED_HTML
        else:
            self.send_error(404, "this server has two pages and that is none of them")
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
        # To stderr, which the guard keeps: a fetch of /opened is expected in
        # the control and a failure in the middle-click run.
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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), OneLink)
    # Flushed before serve_forever, since the guard waits for this line.
    print("serving %s on 127.0.0.1:%d" % (PAGE, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
