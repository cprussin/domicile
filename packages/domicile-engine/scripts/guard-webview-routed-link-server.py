#!/usr/bin/env python3
"""The pages guard-webview-routed-link.sh clicks its way through.

WHAT IS BEING BUILT HERE IS A CROSS-SITE FRAME, and everything else follows
from that. A link inside a frame that is in ANOTHER RENDERER PROCESS cannot
navigate the page around it by itself: Blink hands the navigation to the
browser, which arrives at `WebContentsDelegate::OpenURLFromTab`. That call is
the guard's whole subject, and a frame that happens to be in the SAME process
never makes it -- Blink retargets such a navigation itself and the delegate is
never on the path. So the two pages are served under two different hostnames,
`a.test` and `b.test`, and the engine is started with a resolver rule that
sends both here. Different hosts under different eTLD+1s are different SITES,
which is what site isolation puts in different processes; two ports of one
host would not be, because a site is a scheme and a registrable domain and
ports are not part of it.

  /outer    the page in the browser window, served as a.test. Nothing but a
            full-bleed iframe of b.test's /inner, so every point the guard can
            click inside the window is inside the frame. Says
            `GUARD outer-loaded`.

  /inner    the framed page, served as b.test, and the only page here with
            anything to press. Two links, each filling half of it:

              the TOP half     target="_top" -> /arrived. THE SUBJECT: a link
                               that navigates the page AROUND the frame, which
                               a cross-process frame cannot do for itself
              the BOTTOM half  an ordinary link -> /stayed. THE CONTROL: the
                               same press, on a link that navigates this frame
                               and asks the browser for nothing

            Halves rather than small boxes because the guard works its press
            points out from the window's size, and a target filling half the
            page cannot be missed by a rounding error. Says `GUARD inner-loaded`
            when it runs and `GUARD inner-mousedown` for a press, which is how a
            run says the click reached the frame at all.

  /arrived  what the `_top` link names. `GUARD top-arrived` is the end of the
            whole chain: nothing loads this AS THE TOP PAGE unless the browser
            routed the navigation and the guest committed it.

  /stayed   what the ordinary link names, in the frame it was clicked in. The
            control's positive reading: `GUARD inner-stayed` says the press
            landed on a link and followed it, so the control's *absence* of a
            top-level navigation is a measurement rather than a click that hit
            nothing.

`/arrived` and `/stayed` each say which frame they are in, because that is the
difference between the two runs and the one thing a page can report about
itself that the guard cannot see: `top` for a page that replaced the whole
window, `framed` for one that only replaced the frame.

Served over HTTP rather than as `data:` URLs for the reason
guard-webview-framing-server.py serves its own subject: `crux` reaches no
arbitrary host, and a fixture the guard brings with it cannot change under it.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUTER = "/outer"
INNER = "/inner"
ARRIVED = "/arrived"
STAYED = "/stayed"

# The page in the window: the frame and nothing else. `border: 0` and a full
# viewport, so the guard's press points land in the frame wherever they fall
# inside the element.
OUTER_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page with a frame from somewhere else</title>
    <style>
      html, body { margin: 0; height: 100%%; }
      iframe { display: block; border: 0; width: 100%%; height: 100%%; }
    </style>
  </head>
  <body>
    <iframe src="%(inner)s"></iframe>
    <script>
      console.log("GUARD outer-loaded");
    </script>
  </body>
</html>
"""

# The framed page. `position: fixed` halves rather than flow layout, so where
# each link is does not depend on a font or a default margin.
INNER_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page inside a frame</title>
    <style>
      html, body { margin: 0; height: 100%%; }
      a { display: block; position: fixed; inset-inline: 0; height: 50%%; }
      #top { inset-block-start: 0; background: #204060; }
      #same { inset-block-end: 0; background: #402060; }
    </style>
  </head>
  <body>
    <a id="top" href="%(arrived)s" target="_top">take the whole window</a>
    <a id="same" href="%(stayed)s">stay in this frame</a>
    <script>
      const say = (what) => {
        console.log(`GUARD ${what}`);
      };

      // Where the press landed, in this frame's own coordinates. The reading
      // that says the hit test crossed into the frame rather than stopping at
      // the page around it -- the guard drove the press at the browser
      // window's coordinates, and these are this document's.
      addEventListener("mousedown", (event) => {
        say(`inner-mousedown x=${event.clientX} y=${event.clientY}`);
      });

      say("inner-loaded");
    </script>
  </body>
</html>
"""

# And the two pages the links lead to, each saying which frame it landed in.
# `window.top === window` is the whole difference between the runs: the subject
# replaces the window, the control replaces the frame.
ARRIVED_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>%(which)s</title>
  </head>
  <body>
    <script>
      console.log(
        window.top === window
          ? "GUARD %(which)s top"
          : "GUARD %(which)s framed",
      );
    </script>
  </body>
</html>
"""


class TwoSitesAndTwoLinks(BaseHTTPRequestHandler):
    """Answers the four paths above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path == OUTER:
            # Absolute, and on the OTHER host: a relative src would frame this
            # page's own site, which is same-process and would measure nothing.
            # The port is this server's, read off the request rather than
            # passed in, so the two halves cannot disagree about it.
            body = OUTER_PAGE % {"inner": "http://%s:%d%s" % (self.other_host(), self.server.server_port, INNER)}
        elif self.path == INNER:
            body = INNER_PAGE % {"arrived": ARRIVED, "stayed": STAYED}
        elif self.path == ARRIVED:
            body = ARRIVED_PAGE % {"which": "top-arrived"}
        elif self.path == STAYED:
            body = ARRIVED_PAGE % {"which": "inner-stayed"}
        else:
            self.send_error(404, "this server has four pages and that is none of them")
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

    def other_host(self):
        """The hostname the frame is served under, which is not this request's.

        Read off the `Host` header rather than fixed, so the pair is decided in
        one place -- the guard's `--host-resolver-rules` -- and a run that asked
        for the outer page under the wrong name frames the wrong site loudly
        rather than quietly measuring one process.
        """
        asked = self.headers.get("Host", "").split(":")[0]
        return OTHER_HOST.get(asked, "b.test")

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps: WHICH pages were asked for, and
        # under which host, is a reading of its own. /arrived being requested
        # at all is the far end of what this guard measures.
        sys.stderr.write("%s %s - %s\n" % (self.headers.get("Host", "?"), self.address_string(), fmt % args))


# The two names, and what each one frames. Both resolve here; see the module
# docstring for why they are hosts rather than ports.
OTHER_HOST = {"a.test": "b.test", "b.test": "a.test"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    arguments = parser.parse_args()

    # 127.0.0.1, not 0.0.0.0: nothing outside this machine has any business
    # reaching a guard's fixture. Both hostnames reach it because the engine is
    # told to resolve them here, not because this listens any wider.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), TwoSitesAndTwoLinks)
    # Before serve_forever, so a guard waiting on this line is not waiting on a
    # buffer.
    print("serving %s on 127.0.0.1:%d" % (OUTER, arguments.port), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
