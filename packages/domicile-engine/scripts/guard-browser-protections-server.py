#!/usr/bin/env python3
"""The pages guard-browser-protections.sh shows, at two sites.

`/page?as=ID` is the page a browser window in profile ID opens at 127.0.0.1.
It logs whether it asks sites not to sell or share its data, and puts
`/frame?as=ID` from localhost, another site, in an <iframe>. The frame sets a
cookie and reads it back, so it logs whether a site embedded in another may
keep one. They log to the console, which the engine writes to its log:

  GUARD gpc as=ID value=true|false            navigator.globalPrivacyControl
  GUARD cookie as=ID third-party=kept|blocked the frame's cookie read back

This server logs the header the page was asked for with, to its stdout:

  GUARD sec-gpc as=ID value=V                 the request for /page?as=ID
                                              carried `Sec-GPC: V`

The cookie is `SameSite=None; Secure`, the only kind a site embedded in
another may set. Chromium counts http://localhost as secure for cookies, so
the guard needs no certificate. Served over HTTP for
guard-webview-guest-page.py's reason: `crux` reaches no arbitrary host, and a
bundled fixture cannot change under the guard.
"""

import argparse
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page that says what it asks of sites</title>
  </head>
  <body>
    <script>
      const as = new URLSearchParams(location.search).get("as");
      console.log(`GUARD gpc as=${as} value=${navigator.globalPrivacyControl === true}`);
      const frame = document.createElement("iframe");
      frame.src = `http://localhost:${location.port}/frame?as=${as}`;
      document.body.append(frame);
    </script>
  </body>
</html>
"""

FRAME = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>another site's frame that tries to keep a cookie</title>
  </head>
  <body>
    <script>
      const as = new URLSearchParams(location.search).get("as");
      document.cookie = `probe-${as}=1; SameSite=None; Secure; Path=/`;
      const kept = document.cookie.includes(`probe-${as}=1`);
      console.log(`GUARD cookie as=${as} third-party=${kept ? "kept" : "blocked"}`);
    </script>
  </body>
</html>
"""

# A profile id, as the config allows one. Anything else is not logged as-is.
ID = re.compile(r"^[a-z0-9-]+$")


class TwoSites(BaseHTTPRequestHandler):
    """Answers /page and /frame, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        url = urlsplit(self.path)
        as_ = parse_qs(url.query).get("as", [""])[0]
        if url.path not in ("/page", "/frame") or not ID.match(as_):
            self.send_error(404, "this server has /page?as=ID and /frame?as=ID")
            return

        if url.path == "/page":
            print(
                "GUARD sec-gpc as=%s value=%s"
                % (as_, self.headers.get("Sec-GPC", "none")),
                flush=True,
            )
        body = (PAGE if url.path == "/page" else FRAME).encode("utf-8")
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
    # fixture. localhost reaches it too.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), TwoSites)
    print(
        "serving two sites' pages on 127.0.0.1:%d" % server.server_address[1],
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
