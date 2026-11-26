#!/usr/bin/env python3
"""Serves the page guard-webview-hidden-theme.sh shows in a browser window.

One path, `/page`: a page that is yellow in a light color scheme and blue in a
dark one, so one pixel says which scheme a frame was drawn in. `?mode=control`
turns it dark itself when it is hidden. It logs `GUARD scheme=<scheme> while
<visibility>` when the desktop's scheme reaches it. Served over HTTP
for guard-webview-guest-page.py's reason: `crux` reaches no arbitrary host,
and a bundled fixture cannot change under the guard.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The only path served. Not "/", so a stray request gets a 404 instead of the
# page under test.
PATH = "/page"

PAGE = b"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page in the desktop's theme</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        background: light-dark(rgb(255, 255, 0), rgb(0, 0, 255));
      }
      p { margin: 0; color: light-dark(#333, #ccc); }
    </style>
  </head>
  <body>
    <script>
      // Enough lines that a new color scheme takes the page several frames to
      // draw, as a real site's does.
      document.body.innerHTML = "<p>line</p>".repeat(60000);
      // Says when the page restyled for a new scheme, and whether it was
      // hidden then: a hidden page that draws its new colors hears it hidden.
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
        const scheme = event.matches ? "dark" : "light";
        console.log(`GUARD scheme=${scheme} while ${document.visibilityState}`);
      });
      // While hidden, says twice a second whether the page has the dark scheme
      // and how many animation frames it has run: a page that runs none draws
      // nothing.
      let frames = 0;
      const countFrames = () => {
        frames += 1;
        if (document.visibilityState === "hidden") requestAnimationFrame(countFrames);
      };
      let probe = null;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          frames = 0;
          requestAnimationFrame(countFrames);
          probe = setInterval(() => {
            const dark = matchMedia("(prefers-color-scheme: dark)").matches;
            console.log(`GUARD while hidden: dark=${dark} frames=${frames}`);
          }, 500);
        } else if (probe !== null) {
          clearInterval(probe);
          probe = null;
        }
      });
      // The control turns the page dark itself while it is hidden, which no
      // theme change paints.
      if (location.search === "?mode=control") {
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") {
            document.documentElement.style.colorScheme = "dark";
          }
        });
      }
    </script>
  </body>
</html>
"""


class ServesThePage(BaseHTTPRequestHandler):
    """Answers PATH with the page, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path.split("?")[0] != PATH:
            self.send_error(404, "this server has one page and it is " + PATH)
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)

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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), ServesThePage)
    print("serving a themed page on 127.0.0.1:%d" % server.server_address[1], flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
