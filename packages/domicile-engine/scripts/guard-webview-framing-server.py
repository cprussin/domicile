#!/usr/bin/env python3
"""The three pages guard-webview-framing.sh measures a framing header with.

The guard needs a site that sends X-Frame-Options and CSP frame-ancestors, and
CI has no route to one: `crux` reaches no arbitrary host, and a guard that
depended on a real site would fail on the day that site changed its headers. So
the guard brings its own.

`/refuses` is the subject: one flat colour, and both headers, because that is
what a site sending either one actually does and because they are enforced
differently. ancestor_throttle.cc skips X-Frame-Options entirely when the
response also carries a frame-ancestors directive, which is the spec's
precedence rule -- so a page carrying both is refused by the *stronger* of the
two, and a <webview> that shows it is not passing on the weaker one. `DENY`
rather than `SAMEORIGIN` and `frame-ancestors 'none'` rather than a host list,
so that being served from the same loopback address as everything else in the
run buys the framed page nothing.

Neither is what a guest's main frame is measured against, and that is the
point: AncestorThrottle::ProcessResponseImpl returns PROCEED before either
check for a navigation in an outermost main frame, and a guest's main frame is
one -- FrameTreeNode::IsOutermostMainFrame() is `!GetParentOrOuterDocument()`,
the same helper the frame-ancestors walk bottoms out in.

`/permits` AND `/frames` ARE THE CONTROL, and they are here because the control
that was here before proved nothing. It put an <iframe> on the guard's own
domicile:// document, pointed it at `/refuses`, and required an empty box --
but an <iframe> on a domicile:// document does not load an http page at all, so
it was empty however that page was served. It would have gone on passing with
both headers deleted.

So the control frames the subject from a page that *can* frame it. `/frames` is
an ordinary http document with an <iframe> in it, and the guard loads it twice:
once framing `/permits` and once framing `/refuses`. The two framed pages are
the same bytes in the same colour and differ only in the two headers, which is
what makes the difference between the runs a reading of the headers rather than
of the harness. Without the first run there is no such reading: "the frame is
empty" and "nothing here can draw" are the same picture.

A framed page is one flat colour and nothing else. It is what the probe looks
for, so anything else in it -- a margin, a font, an anti-aliased glyph -- is a
pixel that is not the colour and is not wanted. `/frames` paints the witness
colour around its frame for the opposite reason: the probe has to find *some*
page to be able to report that the framed one is absent.
"""

import argparse
import html
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

# The paths this serves. Named rather than "/" so that a request that reaches
# this server by accident is answered with a 404 rather than with a page the
# verdict is about.
REFUSES = "/refuses"
PERMITS = "/permits"
FRAMES = "/frames"

FRAMED = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page in a frame</title>
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

# The frame is inset the way the shell module insets its <webview>, and in
# whole percentages of a window whose size the harness chose: the framed page
# lands in the same place on the screen in both runs, on integer pixels, so the
# flat colour inside it is not resampled onto a half-pixel edge.
FRAMER = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page that frames another</title>
    <style>
      html,
      body {{
        background: #{witness};
        block-size: 100%;
        inline-size: 100%;
        margin: 0;
        padding: 0;
      }}
      iframe {{
        block-size: 70%;
        border: 0;
        inline-size: 80%;
        inset-block-start: 10%;
        inset-inline-start: 10%;
        position: absolute;
      }}
    </style>
  </head>
  <body>
    <iframe src="{src}"></iframe>
  </body>
</html>
"""


class RefusesFraming(BaseHTTPRequestHandler):
    """Answers the three paths above, and everything else with a 404."""

    # Set by main(), because BaseHTTPRequestHandler is instantiated per request
    # and there is nowhere else to put it.
    colour = "000000"
    witness = "000000"

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        split = urlsplit(self.path)
        if split.path == REFUSES:
            # The whole point of this server. Both headers, always: the guard's
            # subject is a page refused by the stronger of the two.
            self.send_page(
                FRAMED.format(colour=self.colour),
                {
                    "X-Frame-Options": "DENY",
                    "Content-Security-Policy": "frame-ancestors 'none'",
                },
            )
        elif split.path == PERMITS:
            # The same bytes, minus the headers. Everything the control reads
            # rests on that being the only difference between them.
            self.send_page(FRAMED.format(colour=self.colour), {})
        elif split.path == FRAMES:
            self.send_framer(parse_qs(split.query).get("src", []))
        else:
            self.send_error(404, "this server has three pages and that is none of them")

    def send_framer(self, src):
        """The framing page, or a refusal when there is nothing to frame.

        A framer with an empty <iframe> in it renders exactly what a refused
        frame renders, so serving one would hand the guard a passing control it
        has no right to.
        """
        if len(src) == 1:
            self.send_page(
                FRAMER.format(witness=self.witness, src=html.escape(src[0], quote=True)),
                {},
            )
        else:
            self.send_error(400, "%s takes exactly one ?src=" % FRAMES)

    def send_page(self, page, headers):
        """One page, with whatever framing headers it is the fixture for."""
        body = page.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for name, value in headers.items():
            self.send_header(name, value)
        # So a second run cannot be answered by the first run's page out of the
        # HTTP cache, which would make a failure depend on run order -- and,
        # with the control framing two pages in two runs, on which went first.
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
        help="RRGGBB, no leading #; the flat colour a framed page is",
    )
    parser.add_argument(
        "--witness",
        required=True,
        help="RRGGBB, no leading #; what the framing page paints around it",
    )
    arguments = parser.parse_args()

    RefusesFraming.colour = arguments.colour
    RefusesFraming.witness = arguments.witness
    # 127.0.0.1, not 0.0.0.0: nothing outside this machine has any business
    # reaching a guard's fixture.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), RefusesFraming)
    # Before serve_forever, so a guard waiting on this line is not waiting on a
    # buffer.
    print(
        "serving %s, %s and %s on 127.0.0.1:%d"
        % (REFUSES, PERMITS, FRAMES, arguments.port),
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
