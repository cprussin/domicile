#!/usr/bin/env python3
"""Serves the pages for guard-webview-framing.sh.

  /refuses  a flat-colored page sending `X-Frame-Options: DENY` and
            `frame-ancestors 'none'`, as real sites do. Chromium ignores
            X-Frame-Options when frame-ancestors is present (the spec's
            precedence). Neither allows same-origin framing, so sharing the
            loopback host does not help.
  /permits  the same page without the headers.
  /frames   an http page with an <iframe> of `?src=`, on the witness color.

A guest's main frame is an outermost main frame, which
AncestorThrottle::ProcessResponseImpl lets through before either check. That
is what the guard asserts.

The control loads /frames twice, framing /permits and then /refuses. Only the
headers differ, so the difference between runs measures the headers. An
<iframe> on the domicile:// shell is no control: it never loads http pages.

Framed pages are one flat color with no text or margin, since the probe needs
every pixel to match.
"""

import argparse
import html
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

# Not "/", so a stray request gets a 404.
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
        background: #{color};
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

# Inset like the shell module's <webview>, in whole percentages, so both runs
# put the framed page in the same place on integer pixels.
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
    """Serves the three paths above; anything else is a 404."""

    # Set by main(): BaseHTTPRequestHandler is instantiated per request.
    color = "000000"
    witness = "000000"

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        split = urlsplit(self.path)
        if split.path == REFUSES:
            # Both headers, as a real site sends them.
            self.send_page(
                FRAMED.format(color=self.color),
                {
                    "X-Frame-Options": "DENY",
                    "Content-Security-Policy": "frame-ancestors 'none'",
                },
            )
        elif split.path == PERMITS:
            # Must differ from /refuses only in the headers.
            self.send_page(FRAMED.format(color=self.color), {})
        elif split.path == FRAMES:
            self.send_framer(parse_qs(split.query).get("src", []))
        else:
            self.send_error(404, "this server has three pages and that is none of them")

    def send_framer(self, src):
        """Sends the framing page, or a 400 without exactly one `src`.

        An empty <iframe> looks like a refused one, so it would fake a pass.
        """
        if len(src) == 1:
            self.send_page(
                FRAMER.format(witness=self.witness, src=html.escape(src[0], quote=True)),
                {},
            )
        else:
            self.send_error(400, "%s takes exactly one ?src=" % FRAMES)

    def send_page(self, page, headers):
        """Sends an uncached HTML page with the given headers."""
        body = page.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for name, value in headers.items():
            self.send_header(name, value)
        # So one run is not served from another's HTTP cache.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Logged so a failure shows whether the framed page was requested.
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--port",
        type=int,
        required=True,
        help="0 for any free one; the serving line names the one taken",
    )
    parser.add_argument(
        "--color",
        required=True,
        help="RRGGBB, no leading #; the flat color a framed page is",
    )
    parser.add_argument(
        "--witness",
        required=True,
        help="RRGGBB, no leading #; what the framing page paints around it",
    )
    arguments = parser.parse_args()

    RefusesFraming.color = arguments.color
    RefusesFraming.witness = arguments.witness
    # Loopback only: nothing off this machine should reach a test fixture.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), RefusesFraming)
    # Flushed before serve_forever, because guards wait on this line.
    print(
        "serving %s, %s and %s on 127.0.0.1:%d"
        % (REFUSES, PERMITS, FRAMES, server.server_address[1]),
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
