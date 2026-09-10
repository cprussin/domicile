#!/usr/bin/env python3
"""A page that refuses to be framed, served on loopback.

guard-webview-framing.sh needs a site that sends X-Frame-Options and CSP
frame-ancestors, and CI has no route to one: `crux` reaches no arbitrary host,
and a guard that depended on a real site would fail on the day that site
changed its headers. So the guard brings its own.

Both headers, because that is what a site sending either one actually does, and
because they are enforced differently: ancestor_throttle.cc skips
X-Frame-Options entirely when the response also carries a frame-ancestors
directive, which is the spec's precedence rule. So a page carrying both is
refused by the *stronger* of the two, and a <webview> that shows it is not
passing on the weaker one.

Neither is what a guest's main frame is measured against, and that is the
point: AncestorThrottle::ProcessResponseImpl returns PROCEED before either
check for a navigation in an outermost main frame, and a guest's main frame is
one -- FrameTreeNode::IsOutermostMainFrame() is `!GetParentOrOuterDocument()`,
the same helper the frame-ancestors walk bottoms out in.

`DENY` rather than `SAMEORIGIN`, and `frame-ancestors 'none'` rather than a
host list, so that being served from the same loopback address as everything
else in the run buys the framed page nothing.

The body is one flat colour and nothing else. It is what the probe looks for,
so anything else in it -- a margin, a font, an anti-aliased glyph -- is a pixel
that is not the colour and is not wanted.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The one path this serves. Named rather than "/" so that a request that
# reaches this server by accident is answered with a 404 rather than with the
# page the verdict is about.
PATH = "/refuses"

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a site that refuses to be framed</title>
    <style>
      html,
      body {{
        background: #{colour};
        block-size: 100%;
        inline-size: 100%;
        margin: 0;
        padding: 0;
      }}
    </style>
  </head>
  <body></body>
</html>
"""


class RefusesFraming(BaseHTTPRequestHandler):
    """Answers PATH with the page, and everything else with a 404."""

    # Set by main(), because BaseHTTPRequestHandler is instantiated per request
    # and there is nowhere else to put it.
    colour = "000000"

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path != PATH:
            self.send_error(404, "this server has one page and it is " + PATH)
            return

        body = PAGE.format(colour=self.colour).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # The whole point of this server.
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
        # So a second run cannot be answered by the first run's page out of the
        # HTTP cache, which would make a failure depend on run order.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps: whether the framed page was ever
        # *requested* is the first thing to know when it is not on the screen,
        # and it tells apart "the element never asked" from "it asked and the
        # answer was refused".
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument(
        "--colour",
        required=True,
        help="RRGGBB, no leading #; the flat colour the page is",
    )
    arguments = parser.parse_args()

    RefusesFraming.colour = arguments.colour
    # 127.0.0.1, not 0.0.0.0: nothing outside this machine has any business
    # reaching a guard's fixture.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), RefusesFraming)
    # Before serve_forever, so a guard waiting on this line is not waiting on a
    # buffer.
    print("serving %s on 127.0.0.1:%d" % (PATH, arguments.port), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
