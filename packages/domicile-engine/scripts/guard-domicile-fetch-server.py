#!/usr/bin/env python3
"""Serves the page guard-domicile-fetch.sh shows in a <webview>.

The page tries to read the shell's fixture and home's, and reports each way:

  GUARD guest fetch=<read|empty|refused> no-cors=<...> xhr=<...>
              home=<...>

Served over HTTP because crux reaches no outside host.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Not "/", so a stray request gets a 404.
PATH = "/page"

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page that tries to read the shell's files</title>
  </head>
  <body>
    <script>
      const shell = "domicile://shell/guard-domicile-fetch-file.txt";
      const home = "domicile://home/guard-domicile-fetch-file.txt";
      const asText = (read) =>
        read().then(
          (text) => (text.includes("domicile-fetch-fixture") ? "read" : "empty"),
          () => "refused",
        );
      const xhr = (url) =>
        new Promise((resolve, reject) => {
          const request = new XMLHttpRequest();
          request.open("GET", url);
          request.onload = () => resolve(request.responseText);
          request.onerror = () => reject(new Error("xhr failed"));
          request.send();
        });
      Promise.all([
        asText(() => fetch(shell).then((response) => response.text())),
        asText(() =>
          fetch(shell, { mode: "no-cors" }).then((response) => response.text()),
        ),
        asText(() => xhr(shell)),
        asText(() => fetch(home).then((response) => response.text())),
      ]).then(([cors, noCors, request, fromHome]) => {
        console.log(
          `GUARD guest fetch=${cors} no-cors=${noCors} xhr=${request} home=${fromHome}`,
        );
      });
    </script>
  </body>
</html>
"""


class TriesToReadTheShell(BaseHTTPRequestHandler):
    """Answers PATH with the page, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if self.path != PATH:
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
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), TriesToReadTheShell)
    print(
        "serving a page that tries to read the shell's files on 127.0.0.1:%d"
        % server.server_address[1],
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
