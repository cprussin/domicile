#!/usr/bin/env python3
"""The pages guard-webview-context-menu.sh right-clicks its way through.

  /page          the page in the browser window: one link, filling the whole
                 viewport, to /opened, around one picture, /picture.png, that
                 fills it too -- so the press point, worked out from the
                 window's size, is on both. Says `GUARD page-loaded` when it
                 runs and `GUARD page-contextmenu` for the menu the press asks
                 for, which is how a run says the press reached the guest.

                 `?refuse` is the control's: the page cancels its own
                 `contextmenu`, which is a site drawing its own menu, and the
                 shell must then hear nothing.

  /opened        what the link names. Never loaded: the guard reads its
                 address off the menu.

  /picture.png   a one-pixel PNG, so the menu has an image with pixels under
                 it.

Served over HTTP for the reason guard-webview-framing-server.py serves its
own subject: `crux` reaches no arbitrary host.
"""

import argparse
import base64
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PAGE = "/page"
OPENED = "/opened"
PICTURE = "/picture.png"

# One opaque pixel.
PICTURE_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
    "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)

PAGE_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a picture in a link</title>
    <style>
      html, body { margin: 0; height: 100%%; }
      a { display: block; position: fixed; inset: 0; }
      img { display: block; width: 100%%; height: 100%%; }
    </style>
  </head>
  <body>
    <a href="%(opened)s"><img alt="a picture" src="%(picture)s" /></a>
    <script>
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };
      const refuse = new URLSearchParams(location.search).has("refuse");

      // The press reaching the guest, and the site's own say over the menu:
      // a site that cancels it draws its own, and the shell draws none.
      addEventListener("contextmenu", (event) => {
        if (refuse) {
          event.preventDefault();
        }
        say(`page-contextmenu refused=${refuse}`);
      });

      // Once the picture is in, so the menu has pixels under it.
      const picture = document.querySelector("img");
      const loaded = () => {
        say("page-loaded");
      };
      if (picture.complete) {
        loaded();
      } else {
        picture.addEventListener("load", loaded);
      }
    </script>
  </body>
</html>
"""


class PictureInALink(BaseHTTPRequestHandler):
    """Answers the three paths above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        path = urlsplit(self.path).path
        if path == PAGE:
            self.answer(
                "text/html; charset=utf-8",
                (PAGE_HTML % {"opened": OPENED, "picture": PICTURE}).encode("utf-8"),
            )
        elif path == OPENED:
            self.answer("text/html; charset=utf-8", b"<!doctype html><title>opened</title>")
        elif path == PICTURE:
            self.answer("image/png", PICTURE_PNG)
        else:
            self.send_error(404, "this server has three pages and that is none of them")

    def answer(self, content_type, body):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

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

    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), PictureInALink)
    print("serving %s on 127.0.0.1:%d" % (PAGE, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
