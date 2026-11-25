#!/usr/bin/env python3
"""The pages guard-webview-discard.sh shows in browser windows.

Every query is one page, named after it: `/page?subject-2` is `subject-2`.

It logs to the console, which the engine writes to its log:

  GUARD loaded name=NAME                     the page ran
  GUARD scrolled name=NAME                   its first visit scrolled it
  GUARD restored name=NAME history=N scroll=Y
                                             a later visit to the same history
                                             entry: the entries in its history,
                                             and where it is scrolled to
  GUARD tick name=NAME                       once a second, while it lives
  GUARD typed name=typed value=V             the page named `typed` was typed
                                             into, as a user edit

Served over HTTP, not as a `data:` URL, for guard-webview-guest-page.py's
reason: `crux` reaches no arbitrary host, and a bundled fixture cannot change
under the guard.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The only path served. Not "/", so a stray request gets a 404 instead of the
# page under test.
PATH = "/page"

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page that says whether it lives</title>
  </head>
  <body>
    <input id="field" />
    <div style="block-size: 5000px"></div>
    <script>
      const name = location.search.slice(1);
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };
      say(`loaded name=${name}`);
      setInterval(() => {
        say(`tick name=${name}`);
      }, 1000);
      addEventListener("load", () => {
        // After the load, so the browser has scrolled a restored entry back.
        setTimeout(() => {
          if (history.state === null) {
            scrollTo(0, 1000);
            history.replaceState({ visited: true }, "");
            say(`scrolled name=${name}`);
          } else {
            say(
              `restored name=${name} history=${history.length}` +
                ` scroll=${Math.round(scrollY)}`,
            );
          }
        }, 1000);
        if (name === "typed") {
          const field = document.getElementById("field");
          field.focus();
          // An edit command, so content hears of a user edit. Setting `value`
          // is none.
          document.execCommand("insertText", false, "words");
          say(`typed name=${name} value=${field.value}`);
        }
      });
    </script>
  </body>
</html>
"""


class SaysWhetherItLives(BaseHTTPRequestHandler):
    """Answers PATH with the page, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path.split("?", 1)[0] != PATH:
            self.send_error(404, "this server has one page and it is " + PATH)
            return

        body = PAGE.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps.
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

    # 127.0.0.1, not 0.0.0.0: nothing off this machine should reach a guard's
    # fixture.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), SaysWhetherItLives)
    print(
        "serving a page that says whether it lives on 127.0.0.1:%d"
        % server.server_address[1],
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
