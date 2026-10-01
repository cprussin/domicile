#!/usr/bin/env python3
"""The pages guard-webview-find.sh searches, served on loopback.

`guard-webview-find.sh` drives `find()` at a `<webview>` and reads how many
matches the element says the guest's page holds. That needs a page whose count
is known, and CI has no route to one: `crux` reaches no arbitrary host. So the
guard brings its own.

  /words      --word twice in its own text, and once more in a frame
  /framed     that frame: --word once. Linked from /words as `localhost`
              while /words is opened as 127.0.0.1, so the two are different
              SITES and the frame is out of process -- which is the claim the
              element's count makes that its own renderer could not: every
              frame in the page counted, a cross-site one included. Two ports
              of one host would be one site and would not have done
  /elsewhere  where the guest goes after a find, without --word, so the find
              has a new page to end on

Each top-level page says one line to the console, on `load` -- which waits for
its frame -- and the engine writes it to its own log:

  GUARD guest-shown path=/words

Served from one server rather than the shared guest page's, because that one
has one page and says so: what this needs is a count, a frame and somewhere
else to go.

`no-store` so a second run cannot be answered by the first's page out of the
HTTP cache.
"""

import argparse
import html
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The paths this serves, which are also the names `guard-webview-find.js`
# navigates to and the guard's verdict compares. Named rather than "/" so a
# request that arrives by accident is a 404 rather than a page the verdict is
# about.
WORDS = "/words"
FRAMED = "/framed"
ELSEWHERE = "/elsewhere"

# Two of the word here and one in the frame: the three the guard counts. Each
# in a paragraph of its own and between other words, so a match is a match and
# not a run of them.
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
    """Answers the three paths, and everything else with a 404."""

    # Set by main(), because BaseHTTPRequestHandler is instantiated per request
    # and there is nowhere else to put it.
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
        """One page, never cached."""
        body = page.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps -- and one of its readings: whether
        # the frame was ever REQUESTED tells "the count missed the frame" apart
        # from "there was no frame to count".
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
    # 127.0.0.1, not 0.0.0.0: nothing outside this machine has any business
    # reaching a guard's fixture. `localhost` reaches it all the same.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), HasACount)
    # Before serve_forever, so a guard waiting on this line is not waiting on a
    # buffer.
    print(
        "serving %s %s %s on 127.0.0.1:%d"
        % (WORDS, FRAMED, ELSEWHERE, server.server_address[1]),
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
