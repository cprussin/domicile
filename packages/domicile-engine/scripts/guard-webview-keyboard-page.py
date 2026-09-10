#!/usr/bin/env python3
"""The page a browser window shows for guard-webview-keyboard.sh.

It exists to be the thing holding the keyboard while a desktop chord is
pressed, and to say what it was given. Two lines, both to the console, which
the engine writes to its own log:

  GUARD guest-loaded           there is a page in the window at all. In the
                               positive run that is a guest, so this is also
                               the line that says one was created, attached and
                               navigated
  GUARD guest-keydown code=…   a key became a DOM event in the window's page

The second is reported and not asserted, and the difference is worth knowing.
Where the guard runs there is no display for the browser's window to be
activated on, and a page in an unactivated window may be sent no key events at
all -- so this line's absence says nothing about the hook, which is in the
browser process one layer above where a key becomes a DOM event. What the
guard asserts about an unhandled key it measures on that side instead: see
guard-webview-keyboard.sh.

Served over HTTP rather than written as a `data:` URL, for the reason
guard-webview-framing-server.py serves its own subject: `crux` reaches no
arbitrary host, and a fixture the guard brings with it cannot change under it.

The page has no colour and no layout worth the name. Nothing here is measured
in pixels; the whole verdict is in the engine's log.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The one path this serves. Named rather than "/" so a request that arrives by
# accident is a 404 rather than the page the verdict is about.
PATH = "/keys"

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page in a browser window</title>
  </head>
  <body>
    <script>
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };

      // `keydown` on the window, so this hears the key wherever in the page it
      // was delivered. `code` rather than `key`, because the guard drives a
      // physical key and evdev is what the desktop's claims are written in.
      addEventListener("keydown", (event) => {
        say(`guest-keydown code=${event.code} alt=${event.altKey}`);
      });

      say("guest-loaded");
    </script>
  </body>
</html>
"""


class ShowsWhatItWasTyped(BaseHTTPRequestHandler):
    """Answers PATH with the page, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path != PATH:
            self.send_error(404, "this server has one page and it is " + PATH)
            return

        body = PAGE.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # So a second run cannot be answered by the first run's page out of the
        # HTTP cache, which would make a failure depend on run order.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps: whether the page was ever
        # *requested* tells "the element never asked for it" apart from "it
        # asked and the page did not run".
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    arguments = parser.parse_args()

    # 127.0.0.1, not 0.0.0.0: nothing outside this machine has any business
    # reaching a guard's fixture.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), ShowsWhatItWasTyped)
    # Before serve_forever, so a guard waiting on this line is not waiting on a
    # buffer.
    print("serving %s on 127.0.0.1:%d" % (PATH, arguments.port), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
