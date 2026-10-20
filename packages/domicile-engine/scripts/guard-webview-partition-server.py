#!/usr/bin/env python3
"""Serves the pages guard-webview-partition.sh loads.

  /write?as=NAME&key=KEY  stores KEY in the page's IndexedDB, then reports
                          `wrote as=NAME`.
  /read?as=NAME           reports `read as=NAME keys=…`, the keys the page's
                          IndexedDB holds, comma-separated and sorted, or
                          `(none)`.
  /report?line=           prints `GUARD <line>` to stdout, which the guard
                          reads.

Both pages go to `#reported` once the report is in, so the shell knows.

IndexedDB, not a cookie: a transaction completes once its write reached the
backing store, so the write survives the engine being killed, and the restart
reads it. A cookie waits up to 30 seconds to be written.

One server for both engine runs: storage is per origin, and the origin has the
port.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

WRITE = "/write"
READ = "/read"
REPORT = "/report"

# Opens the database, making its one store on first use.
OPEN = """
      const open = () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("guard", 1);
          request.onupgradeneeded = () => {
            request.result.createObjectStore("keys");
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const report = (line) =>
        fetch(`/report?line=${encodeURIComponent(line)}`).then(() => {
          location.hash = "reported";
        });
"""

WRITE_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>write</title>
  </head>
  <body>
    <script>
%(open)s
      open()
        .then(
          (db) =>
            new Promise((resolve, reject) => {
              const write = db.transaction("keys", "readwrite");
              write.objectStore("keys").put(1, "%(key)s");
              write.oncomplete = resolve;
              write.onerror = () => reject(write.error);
            }),
        )
        .then(() => report("wrote as=%(name)s"))
        .catch((error) => report(`failed as=%(name)s error=${error}`));
    </script>
  </body>
</html>
"""

READ_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>read</title>
  </head>
  <body>
    <script>
%(open)s
      open()
        .then(
          (db) =>
            new Promise((resolve, reject) => {
              const read = db.transaction("keys").objectStore("keys").getAllKeys();
              read.onsuccess = () => resolve(read.result);
              read.onerror = () => reject(read.error);
            }),
        )
        .then((keys) =>
          report(`read as=%(name)s keys=${keys.sort().join(",") || "(none)"}`),
        )
        .catch((error) => report(`failed as=%(name)s error=${error}`));
    </script>
  </body>
</html>
"""


def letters(query, name):
    """The query parameter `name`, with anything but letters dropped, so it
    cannot break out of the page's strings."""
    return "".join(c for c in parse_qs(query).get(name, [""])[0] if c.isalpha())


class WriteAndRead(BaseHTTPRequestHandler):
    """Answers the three paths above, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        url = urlparse(self.path)
        if url.path == WRITE:
            body = WRITE_PAGE % {
                "open": OPEN,
                "name": letters(url.query, "as"),
                "key": letters(url.query, "key"),
            }
        elif url.path == READ:
            body = READ_PAGE % {"open": OPEN, "name": letters(url.query, "as")}
        elif url.path == REPORT:
            line = parse_qs(url.query).get("line", [""])[0]
            print("GUARD %s" % line, flush=True)
            body = ""
        else:
            self.send_error(404, "this server has three paths and that is none of them")
            return

        encoded = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        # So a run is never served a cached page from an earlier run.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

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

    # Loopback only: nothing outside this machine should reach the fixture.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), WriteAndRead)
    # Flushed before serve_forever, since the guard waits for this line.
    print("serving %s on 127.0.0.1:%d" % (WRITE, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
