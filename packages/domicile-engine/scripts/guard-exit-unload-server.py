#!/usr/bin/env python3
"""The pages guard-exit-unload.sh shows in browser windows.

`/lock` holds a lock in localStorage and gives it up in `pagehide`. `/hung`
never returns from its own. They log to the console, which the engine writes to
its log:

  GUARD lock-was=held|free   the lock as `/lock` found it, then takes it
  GUARD hung-loaded          `/hung` ran
  GUARD hung-hiding          `/hung` is in its `pagehide`

Served over HTTP, not as a `data:` URL, which has no localStorage.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page that unloads</title>
  </head>
  <body>
    <script>%s</script>
  </body>
</html>
"""

PAGES = {
    "/lock": """
      const was = localStorage.getItem("lock") === null ? "free" : "held";
      console.log(`GUARD lock-was=${was}`);
      localStorage.setItem("lock", "held");
      addEventListener("pagehide", () => {
        localStorage.removeItem("lock");
      });
    """,
    "/hung": """
      addEventListener("pagehide", () => {
        console.log("GUARD hung-hiding");
        for (;;) {}
      });
      console.log("GUARD hung-loaded");
    """,
}


class Pages(BaseHTTPRequestHandler):
    """Answers each of PAGES, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        script = PAGES.get(self.path)
        if script is None:
            self.send_error(404, "this server has " + " and ".join(PAGES))
            return

        body = (PAGE % script).encode("utf-8")
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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), Pages)
    print(
        "serving pages that unload on 127.0.0.1:%d" % server.server_address[1],
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
