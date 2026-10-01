#!/usr/bin/env python3
"""The pages guard-shell-local-network.sh measures Local Network Access with.

`/picture` is the subject: an image of one flat color, which the probe looks
for. `/shows?src=` is the control's page: an ordinary http document with that
image in it, on the witness color, so the control can show the same picture
from a page Local Network Access does apply to.

The guard runs two of these. The engine is told one of them is public
(`--ip-address-space-overrides`), so a picture fetched from the other is a
request into the loopback space -- what a bookmark on localhost is to the
shell.
"""

import argparse
import html
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

PICTURE = "/picture"
SHOWS = "/shows"

# Stretched over the whole box, so every pixel of the <img> is the color.
SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" \
preserveAspectRatio="none"><rect width="1" height="1" fill="#{color}"/></svg>
"""

# Inset the way the shell module insets its <img>, so both runs put the
# picture in the same place.
SHOWER = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page showing a picture</title>
    <style>
      html,
      body {{
        background: #{witness};
        block-size: 100%;
        inline-size: 100%;
        margin: 0;
        padding: 0;
      }}
      img {{
        block-size: 70%;
        inline-size: 80%;
        inset-block-start: 10%;
        inset-inline-start: 10%;
        position: absolute;
      }}
    </style>
  </head>
  <body>
    <img alt="" src="{src}" />
  </body>
</html>
"""


class Pictures(BaseHTTPRequestHandler):
    """Answers the two paths above, and everything else with a 404."""

    # Set by main(): BaseHTTPRequestHandler is instantiated per request.
    color = "000000"
    witness = "000000"

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        split = urlsplit(self.path)
        if split.path == PICTURE:
            self.send(SVG.format(color=self.color), "image/svg+xml")
        elif split.path == SHOWS:
            src = parse_qs(split.query).get("src", [])
            # An empty <img> renders what a blocked one renders, so serving one
            # would hand the control a pass it has no right to.
            if len(src) == 1:
                self.send(
                    SHOWER.format(
                        witness=self.witness, src=html.escape(src[0], quote=True)
                    ),
                    "text/html; charset=utf-8",
                )
            else:
                self.send_error(400, "%s takes exactly one ?src=" % SHOWS)
        else:
            self.send_error(404, "this server has two pages and that is none of them")

    def send(self, page, content_type):
        body = page.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        # So no run is answered out of another's cache: LNA retries a cached
        # response over the network rather than reading the cache's verdict.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps: whether the picture was ever
        # requested tells "blocked before it left" from "never asked for".
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True,
                        help="0 for any free one; the serving line names it")
    parser.add_argument("--color", required=True,
                        help="RRGGBB, no leading #; the picture's color")
    parser.add_argument("--witness", required=True,
                        help="RRGGBB, no leading #; what /shows paints around it")
    arguments = parser.parse_args()

    Pictures.color = arguments.color
    Pictures.witness = arguments.witness
    # 127.0.0.1, not 0.0.0.0: nothing off this machine has any business here.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), Pictures)
    print(
        "serving %s and %s on 127.0.0.1:%d"
        % (PICTURE, SHOWS, server.server_address[1]),
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
