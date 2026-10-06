#!/usr/bin/env python3
"""Serves pages with a known match count for guard-webview-find.sh.

  /words      --word twice, plus a frame holding it once more
  /framed     that frame: --word once. Loaded as `localhost` while /words is
              127.0.0.1, so it is cross-site and out of process, and the count
              must include it. Two ports on one host would be the same site.
  /elsewhere  a page without --word, to navigate to after a find

Each top-level page logs `GUARD guest-shown path=<path>` on `load`, which waits
for its frame.
"""

import argparse
import html
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Also used by `guard-webview-find.js` and the guard's verdict. Not "/", so a
# stray request gets a 404.
WORDS = "/words"
FRAMED = "/framed"
ELSEWHERE = "/elsewhere"

# Two matches here and one in the frame. Each sits between other words so
# matches cannot merge.
WORDS_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page to find in</title>
  </head>
  <body>
    <p>the first {word} is here</p>
    <iframe src="{frame}"></iframe>
    <p>and the second {word} is here</p>
    <script>
      addEventListener("load", () => {{
        console.log("GUARD guest-shown path={path}");
      }});
    </script>
  </body>
</html>
"""

FRAMED_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a frame to find in</title>
  </head>
  <body>
    <p>the third {word} is in a frame</p>
  </body>
</html>
"""

ELSEWHERE_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page with nothing to find</title>
  </head>
  <body>
    <p>nothing here</p>
    <script>
      addEventListener("load", () => {{
        console.log("GUARD guest-shown path={path}");
      }});
    </script>
  </body>
</html>
"""


class HasACount(BaseHTTPRequestHandler):
    """Serves the three paths; anything else is a 404."""

    # Set by main(): BaseHTTPRequestHandler is instantiated per request.
    word = ""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        word = html.escape(self.word)
        if self.path == WORDS:
            frame = "http://localhost:%d%s" % (self.server.server_address[1], FRAMED)
            self.send_page(WORDS_PAGE.format(word=word, frame=frame, path=WORDS))
        elif self.path == FRAMED:
            self.send_page(FRAMED_PAGE.format(word=word))
        elif self.path == ELSEWHERE:
            self.send_page(ELSEWHERE_PAGE.format(path=ELSEWHERE))
        else:
            self.send_error(404, "this server has three pages: /words /framed /elsewhere")

    def send_page(self, page):
        """Sends an uncached HTML page."""
        body = page.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # The guard reads this: a request for /framed tells "the count missed
        # the frame" from "there was no frame".
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
        "--word",
        required=True,
        help="what the pages hold to be found: twice on %s, once in %s"
        % (WORDS, FRAMED),
    )
    arguments = parser.parse_args()

    HasACount.word = arguments.word
    # Loopback only: nothing off this machine should reach a test fixture.
    # `localhost` still reaches it.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), HasACount)
    # Flushed before serve_forever, because guards wait on this line.
    print(
        "serving %s %s %s on 127.0.0.1:%d"
        % (WORDS, FRAMED, ELSEWHERE, server.server_address[1]),
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
