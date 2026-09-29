#!/usr/bin/env python3
"""The pages guard-webview-upload.sh and guard-webview-download.sh click.

  /upload    an `<input type="file">` filling the whole page, so a press
             anywhere in the window lands on it. When the page is given a file
             it READS it and says `GUARD picked name=<name> text=<contents>`:
             the contents are the reading that says the browser granted this
             renderer the file, which a name alone would not. When the chooser
             is canceled the input fires `cancel`, and the page says
             `GUARD picked-nothing`.

  /download  one link filling the whole page, to /file, with `download` on it.

  /file      a few bytes served as an attachment named `guard-download.txt`,
             which is the name the shell must be offered as the suggestion.

Each page says `GUARD <name>-loaded` when it runs and `GUARD guest-mousedown`
for a press, which is how a run says the click reached the guest at all rather
than stopping at the element.

Served over HTTP for the reason guard-webview-new-window-server.py is: `crux`
reaches no arbitrary host, and a request in the log is how a run tells "never
asked for" from "asked for and did nothing".
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPLOAD = "/upload"
DOWNLOAD = "/download"
FILE = "/file"

# What /file holds and what it is called. The download guard reads both back
# off the disk, so they are the guard's to know too.
FILE_NAME = "guard-download.txt"
FILE_TEXT = "a file the shell was asked where to put"

# The two pages, around one element that fills the viewport -- `position:
# fixed` rather than flow layout, so where it is does not depend on a font.
PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>%(which)s</title>
    <style>
      html, body { margin: 0; height: 100%%; }
      #target { display: block; position: fixed; inset: 0; width: 100%%;
                height: 100%%; background: #204060; }
    </style>
  </head>
  <body>
    %(target)s
    <script>
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };
      addEventListener("mousedown", (event) => {
        say(`guest-mousedown x=${event.clientX} y=${event.clientY}`);
      });
      %(script)s
      say("%(which)s-loaded");
    </script>
  </body>
</html>
"""

UPLOAD_TARGET = '<input id="target" type="file" />'
UPLOAD_SCRIPT = """
      const input = document.getElementById("target");
      input.addEventListener("change", () => {
        const [file] = input.files;
        file.text().then((text) => {
          say(`picked name=${file.name} text=${text}`);
        });
      });
      input.addEventListener("cancel", () => {
        say("picked-nothing");
      });
"""

DOWNLOAD_TARGET = '<a id="target" href="%s" download>download</a>' % FILE


class PagesToPickFor(BaseHTTPRequestHandler):
    """Answers the three paths above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path == UPLOAD:
            self.answer(
                "text/html; charset=utf-8",
                PAGE % {"which": "upload", "target": UPLOAD_TARGET, "script": UPLOAD_SCRIPT},
            )
        elif self.path == DOWNLOAD:
            self.answer(
                "text/html; charset=utf-8",
                PAGE % {"which": "download", "target": DOWNLOAD_TARGET, "script": ""},
            )
        elif self.path == FILE:
            self.answer(
                "text/plain; charset=utf-8",
                FILE_TEXT,
                disposition='attachment; filename="%s"' % FILE_NAME,
            )
        else:
            self.send_error(404, "this server has three pages and that is none of them")

    def answer(self, content_type, body, disposition=None):
        encoded = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(encoded)))
        if disposition is not None:
            self.send_header("Content-Disposition", disposition)
        # So a second run cannot be answered out of the first run's cache.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps: whether /file was ever asked for is
        # a reading of its own.
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

    # 127.0.0.1, not 0.0.0.0: nothing outside this machine has any business
    # reaching a guard's fixture.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), PagesToPickFor)
    print("serving %s on 127.0.0.1:%d" % (UPLOAD, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
