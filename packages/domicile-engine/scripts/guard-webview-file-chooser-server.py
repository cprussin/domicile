#!/usr/bin/env python3
"""Serves the pages for guard-webview-upload.sh, guard-webview-download.sh and
guard-webview-save-picker.sh.

  /upload    a full-page `<input type="file">`. Logs `GUARD picked name=<name>
             text=<contents>` for a chosen file; reading the contents proves the
             renderer was granted it. Logs `GUARD picked-nothing` on cancel.

  /download  a full-page link to /file with `download`.

  /file      a few bytes as an attachment named `guard-download.txt`, the
             name the shell must be offered.

  /save      a full-page button calling `showSaveFilePicker()` for
             `guard-save.txt` and writing to the result. Logs
             `GUARD saved name=<name>`, or `GUARD save-refused <error>`.

Each page logs `GUARD <name>-loaded` and `GUARD guest-mousedown`, so a run can
tell that a click reached the guest. Requests are logged to stderr.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPLOAD = "/upload"
DOWNLOAD = "/download"
FILE = "/file"
SAVE = "/save"

# guard-webview-download.sh checks both; keep them in sync.
FILE_NAME = "guard-download.txt"
FILE_TEXT = "a file the shell was asked where to put"

# One element fills the viewport, fixed-positioned so its box does not
# depend on fonts.
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

# guard-webview-save-picker.sh checks both; keep them in sync.
SAVE_NAME = "guard-save.txt"
SAVE_TEXT = "a file a page saved where the shell said"

SAVE_TARGET = '<button id="target">save</button>'
SAVE_SCRIPT = """
      document.getElementById("target").addEventListener("click", () => {
        showSaveFilePicker({ suggestedName: "%s" }).then(
          async (handle) => {
            const writable = await handle.createWritable();
            await writable.write("%s");
            await writable.close();
            say(`saved name=${handle.name}`);
          },
          (error) => {
            say(`save-refused ${error.name}`);
          },
        );
      });
""" % (SAVE_NAME, SAVE_TEXT)


class PagesToPickFor(BaseHTTPRequestHandler):
    """Serves the four paths above; anything else is a 404."""

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
        elif self.path == SAVE:
            self.answer(
                "text/html; charset=utf-8",
                PAGE % {"which": "save", "target": SAVE_TARGET, "script": SAVE_SCRIPT},
            )
        elif self.path == FILE:
            self.answer(
                "text/plain; charset=utf-8",
                FILE_TEXT,
                disposition='attachment; filename="%s"' % FILE_NAME,
            )
        else:
            self.send_error(404, "this server has four pages and that is none of them")

    def answer(self, content_type, body, disposition=None):
        encoded = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(encoded)))
        if disposition is not None:
            self.send_header("Content-Disposition", disposition)
        # So one run is not served from another's HTTP cache.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt, *args):
        # Logged so the guard can see whether /file was requested.
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

    # Loopback only: nothing off this machine should reach a test fixture.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), PagesToPickFor)
    print("serving %s on 127.0.0.1:%d" % (UPLOAD, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
