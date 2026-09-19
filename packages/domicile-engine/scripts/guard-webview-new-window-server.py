#!/usr/bin/env python3
"""The three pages guard-webview-new-window.sh clicks its way through.

Its own server rather than `guard-webview-guest-page.py`, which is the fixture
the keyboard and click guards share: what those two need is a page that says
what it was given, and what this one needs is a page with two links in known
halves of it and the two pages they lead to. One fixture serving both would be
a page whose layout the other guards' clicks depend on.

  /opener   the page in the browser window. Nothing but two links, each filling
            half of it:

              the TOP half    target="_blank" -> /opened. THE SUBJECT: a link
                              that asks for a window of its own, which is what
                              a guest cannot be given and what the shell is
                              told about instead
              the BOTTOM half an ordinary link -> /stayed. THE CONTROL: the
                              same click, in the same page, landing on a link
                              that asks for no window

            Halves rather than two small boxes because the guard clicks a point
            it works out from the window's size, and a target that fills half
            the page cannot be missed by a rounding error. It says
            `GUARD opener-loaded` when it runs and `GUARD guest-mousedown` for
            a press, which is how a run says the click reached the guest at all
            rather than stopping at the element.

  /opened   what the `target="_blank"` link names. Saying `GUARD opened-loaded`
            is the end of the whole chain: nothing loads this unless the shell
            opened a second <webview> and pointed it here, so it is the one
            reading that says the user got a window rather than an event.

  /stayed   what the ordinary link names, in the window it was clicked in. The
            control's positive reading: `GUARD stayed-loaded` says the press
            landed on a link and followed it, so the control's *absence* of a
            new window is a measurement rather than a click that hit nothing.

Served over HTTP rather than as `data:` URLs for the reason
guard-webview-framing-server.py serves its own subject: `crux` reaches no
arbitrary host, a fixture the guard brings with it cannot change under it, and
a request in the log is how a run tells "the element never asked for it" from
"it asked and the page did not run".

No color and no layout worth the name. Nothing here is measured in pixels; the
whole verdict is in the engine's log.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OPENER = "/opener"
OPENED = "/opened"
STAYED = "/stayed"

# The page in the window. `position: fixed` halves rather than flow layout, so
# where each link is does not depend on a font or a default margin -- the guard
# computes its two press points from the window's size and nothing else.
OPENER_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page that wants another window</title>
    <style>
      html, body { margin: 0; height: 100%%; }
      a { display: block; position: fixed; inset-inline: 0; height: 50%%; }
      #blank { inset-block-start: 0; background: #204060; }
      #same { inset-block-end: 0; background: #402060; }
    </style>
  </head>
  <body>
    <a id="blank" href="%(opened)s" target="_blank">open a window</a>
    <a id="same" href="%(stayed)s">stay in this one</a>
    <script>
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };

      // Where the press landed, in this page's own coordinates. The reading
      // that says the hit test crossed into the guest rather than stopping at
      // the element around it -- the guard drove the press at the browser
      // window's coordinates, and these are the page's.
      addEventListener("mousedown", (event) => {
        say(`guest-mousedown x=${event.clientX} y=${event.clientY}`);
      });

      say("opener-loaded");
    </script>
  </body>
</html>
"""

# And the two pages the links lead to. Each says which one it is and nothing
# else: what is being measured is which of them ran, and where.
ARRIVED_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>%(which)s</title>
  </head>
  <body>
    <script>
      console.log("GUARD %(which)s-loaded");
    </script>
  </body>
</html>
"""


class TwoLinksAndWhereTheyGo(BaseHTTPRequestHandler):
    """Answers the three paths above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path == OPENER:
            body = OPENER_PAGE % {"opened": OPENED, "stayed": STAYED}
        elif self.path == OPENED:
            body = ARRIVED_PAGE % {"which": "opened"}
        elif self.path == STAYED:
            body = ARRIVED_PAGE % {"which": "stayed"}
        else:
            self.send_error(404, "this server has three pages and that is none of them")
            return

        encoded = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        # So a second run cannot be answered by the first run's page out of the
        # HTTP cache, which would make a failure depend on run order.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps: WHICH pages were asked for is a
        # reading of its own. /opened being requested at all is the second
        # <webview> having been made and navigated, which is the far end of
        # what this guard measures.
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    arguments = parser.parse_args()

    # 127.0.0.1, not 0.0.0.0: nothing outside this machine has any business
    # reaching a guard's fixture.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), TwoLinksAndWhereTheyGo)
    # Before serve_forever, so a guard waiting on this line is not waiting on a
    # buffer.
    print("serving %s on 127.0.0.1:%d" % (OPENER, arguments.port), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
