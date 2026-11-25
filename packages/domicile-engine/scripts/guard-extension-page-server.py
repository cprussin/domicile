#!/usr/bin/env python3
"""The page guard-extension-page.sh shows, and what it says it heard.

The page cancels every key, as a site with its own shortcuts does. It tells
this server, which prints, what it heard:

  GUARD page-loaded at=WHERE         the page ran
  GUARD page-key at=WHERE code=CODE  it was given a key

WHERE is the page's `?at=`. Told to the server rather than the console: the
engine's log leaves out a private page's console.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page that cancels every key</title>
  </head>
  <body>
    <p>words to click on</p>
    <script>
      const at = new URLSearchParams(location.search).get("at");
      const say = (what) => {
        fetch(`/said?${new URLSearchParams({ what, at })}`);
      };
      addEventListener("keydown", (event) => {
        event.preventDefault();
        say(event.code);
      });
      say("loaded");
    </script>
  </body>
</html>
"""


def line_for(what, at):
    """What to print for what the page at `at` said."""
    return (
        "GUARD page-loaded at=%s" % at
        if what == "loaded"
        else "GUARD page-key at=%s code=%s" % (at, what)
    )


class Listens(BaseHTTPRequestHandler):
    """Answers /page with the page, and prints what it says at /said."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        asked = urlsplit(self.path)
        if asked.path == "/page":
            self.answer(PAGE)
        elif asked.path == "/said":
            said = parse_qs(asked.query)
            print(line_for(said["what"][0], said["at"][0]), flush=True)
            self.answer("")
        else:
            self.send_error(404, "this server has one page and it is /page")

    def answer(self, text):
        body = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), Listens)
    # Flushed before serve_forever, because the guard waits on this line.
    print("serving /page on 127.0.0.1:%d" % server.server_address[1], flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
