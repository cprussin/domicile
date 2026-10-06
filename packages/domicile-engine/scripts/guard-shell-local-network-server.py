#!/usr/bin/env python3
"""HTTP server for guard-shell-local-network.sh's Local Network Access check.

- `/picture`: a flat-color image the probe looks for.
- `/shows?src=`: a plain http page showing that image on the witness color,
  for the control, where Local Network Access applies.

The guard runs two servers and marks one public with
`--ip-address-space-overrides`, so fetching from the other is a loopback
request, like a shell favicon for a bookmark on localhost.
"""

import argparse
import html
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

PICTURE = "/picture"
SHOWS = "/shows"

# Stretches over the whole <img>, so every pixel is the color.
SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" \
preserveAspectRatio="none"><rect width="1" height="1" fill="#{color}"/></svg>
"""

# Same inset as the shell module's <img>, so both runs place it alike.
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
    """Serves the two paths above; anything else is a 404."""

    # Set by main(): BaseHTTPRequestHandler is instantiated per request.
    color = "000000"
    witness = "000000"

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        split = urlsplit(self.path)
        if split.path == PICTURE:
            self.send(SVG.format(color=self.color), "image/svg+xml")
        elif split.path == SHOWS:
            src = parse_qs(split.query).get("src", [])
            # An empty <img> looks like a blocked one and would pass the
            # control falsely.
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
        # Keep runs from sharing a cache: LNA re-checks a cached response over
        # the network.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # The guard keeps stderr. A request here tells "blocked" from "never
        # asked for".
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
    # Loopback only.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), Pictures)
    print(
        "serving %s and %s on 127.0.0.1:%d"
        % (PICTURE, SHOWS, server.server_address[1]),
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
