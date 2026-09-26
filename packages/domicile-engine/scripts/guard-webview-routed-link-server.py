#!/usr/bin/env python3
"""The pages guard-webview-routed-link.sh middle-clicks its way through.

WHAT IS BEING BUILT HERE IS ONE ORDINARY LINK, and the plainness is the point.
The gesture under test is a MIDDLE CLICK, which asks for the link in a second
window -- and a page cannot open one, so the browser has to. That request
arrives at `WebContentsDelegate::OpenURLFromTab` with a new-window disposition,
and content's default implementation returns null and does nothing. Nothing
about the link has to be special for that: no target, no frame, no second
origin. The BUTTON is the whole experiment.

  /page     the page in the browser window, and the only page here with
            anything to press: one link, filling the whole viewport, to
            /opened. Full-bleed because the guard works its press point out
            from the window's size, and a target covering the page cannot be
            missed by a rounding error. Says `GUARD page-loaded` when it runs
            and `GUARD page-mousedown` for a press, which is how a run says the
            click reached the guest at all.

  /opened   what the link names. Which run this appears in is the measurement
            rather than a detail:

              the CLAIM's run     middle-clicks, so this must NOT load. The
                                  window it was asked for is the shell's to
                                  open, and the guard reads the shell's event
                                  for the address instead
              the CONTROL's run   left-clicks the same point on the same link,
                                  so this MUST load, in the guest, in place --
                                  which is what says the press landed on a link
                                  at all and the control's silence is a
                                  measurement rather than a miss

A PREVIOUS VERSION OF THIS FILE SERVED FOUR PAGES UNDER TWO HOSTNAMES, framing
`b.test` inside `a.test` so that a `target="_top"` link would cross a process
boundary. Engine run 35487254436 showed that gesture never reaches a delegate
at this pin -- the frame was genuinely remote, the top page arrived, and the
engine's line never appeared -- so Chromium performs it inside
`Navigator::NavigateFromFrameProxy` without asking anyone. The fixture lost the
second host, the frame and two pages with it. guard-webview-routed-link.sh's
header carries the full account.

Served over HTTP rather than as `data:` URLs for the reason
guard-webview-framing-server.py serves its own subject: `crux` reaches no
arbitrary host, and a fixture the guard brings with it cannot change under it.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PAGE = "/page"
OPENED = "/opened"

# The page in the window: one link and nothing else. `position: fixed` with a
# full inset rather than flow layout, so where the link is does not depend on a
# font or a default margin.
PAGE_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page with one link</title>
    <style>
      html, body { margin: 0; height: 100%%; }
      a { display: block; position: fixed; inset: 0; background: #204060; }
    </style>
  </head>
  <body>
    <a id="link" href="%(opened)s">open me somewhere</a>
    <script>
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };

      // Where the press landed, in this document's own coordinates. The
      // reading that says the hit test crossed into the guest rather than
      // stopping at the chrome around it -- the guard drove the press at the
      // browser window's coordinates, and these are this page's.
      //
      // `mousedown` fires for every button, which is what this has to see: the
      // run presses the middle one and the control the left one, and a run
      // where neither reached the page at all must not read like a run where
      // one did and nothing came of it.
      addEventListener("mousedown", (event) => {
        say(`page-mousedown button=${event.button} x=${event.clientX} y=${event.clientY}`);
      });

      say("page-loaded");
    </script>
  </body>
</html>
"""

# What the link names. It says which frame it is in for the same reason the
# `_top` fixture's arrival pages did: a page that loaded SOMEWHERE is not the
# same measurement as a page that replaced the guest's own document, and only
# the page can say which happened to it.
OPENED_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>opened</title>
  </head>
  <body>
    <script>
      console.log(
        window.top === window
          ? "GUARD opened-loaded top"
          : "GUARD opened-loaded framed",
      );
    </script>
  </body>
</html>
"""


class OneLink(BaseHTTPRequestHandler):
    """Answers the two paths above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path == PAGE:
            body = PAGE_HTML % {"opened": OPENED}
        elif self.path == OPENED:
            body = OPENED_HTML
        else:
            self.send_error(404, "this server has two pages and that is none of them")
            return

        encoded = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        # So a second run cannot be answered by the first run's page out of the
        # HTTP cache, which would make a failure depend on run order.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps: WHICH pages were asked for is a
        # reading of its own. /opened being fetched at all separates the
        # control's run from the claim's, and in the claim's run a fetch of it
        # is the finding rather than the noise.
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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), OneLink)
    # Before serve_forever, so a guard waiting on this line is not waiting on a
    # buffer.
    print("serving %s on 127.0.0.1:%d" % (PAGE, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
