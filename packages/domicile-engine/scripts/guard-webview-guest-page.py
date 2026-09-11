#!/usr/bin/env python3
"""The page a browser window shows, for the guards that put one in a window.

One fixture rather than one per guard: what both of them need from it is a
page that is unmistakably *in the window* and says what it was given, and a
second copy of an HTTP server would be a second place for that to drift.
`guard-webview-keyboard.sh` presses a key at it; `guard-webview-click.sh`
clicks in it.

Four lines, all to the console, which the engine writes to its own log:

  GUARD guest-loaded             there is a page in the window at all. In a
                                 positive run that is a guest, so this is also
                                 the line that says one was created, attached
                                 and navigated
  GUARD guest-keydown code=…     a key became a DOM event in the window's page
  GUARD guest-mousedown x=… y=…  a press became one, at the point in the page
                                 it landed on
  GUARD guest-window-focus       this page's window took focus, which is the
                                 far side of the question the click guard asks:
                                 whether a press in here moved focus at all

None of the last three is asserted, and why differs between them. Where these
guards run there is no display for the browser's window to be activated on, and
a page in an unactivated window may be sent no *key* events at all -- so
`guest-keydown`'s absence says nothing about the hook the keyboard guard is
about, which is in the browser process one layer above where a key becomes a
DOM event. `guest-window-focus` is in the same position for the same reason,
and is read as what it is: a reason a run found nothing, rather than a verdict
on anything.

`guest-mousedown` is not in that position. A press is routed by hit test
rather than by focus, so it reaches the widget under it whatever the window's
activation, and the click guard reads it as the fact its whole verdict rests
on: that the press landed in the guest rather than in the shell around it.

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
PATH = "/page"

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

      // And the press, with where in this page it landed. The coordinates are
      // the reading that says the hit test crossed into the guest rather than
      // stopping at the element: they are this page's, and the guard drove the
      // press at the browser window's.
      addEventListener("mousedown", (event) => {
        say(`guest-mousedown x=${event.clientX} y=${event.clientY}`);
      });

      // Whether the press moved focus INTO this page, asked here because it is
      // the only place that can answer it. The click guard's whole question is
      // what a shell outside is told when that happens; a run where it never
      // happened is asking nothing.
      addEventListener("focus", () => {
        say("guest-window-focus");
      });

      say("guest-loaded");
    </script>
  </body>
</html>
"""


class ShowsWhatItWasGiven(BaseHTTPRequestHandler):
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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), ShowsWhatItWasGiven)
    # Before serve_forever, so a guard waiting on this line is not waiting on a
    # buffer.
    print("serving %s on 127.0.0.1:%d" % (PATH, arguments.port), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
