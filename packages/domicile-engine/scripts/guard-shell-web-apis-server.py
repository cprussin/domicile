"""The other origin guard-shell-web-apis.sh's shell reads from.

`/cors` answers `ok` and lets any origin read it, as a web API does;
`/no-cors` answers the same and lets no other origin read it, which is the
control's second leg: a fetch the browser must refuse to hand the shell.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PATHS = {"/cors": True, "/no-cors": False}


class Answers(BaseHTTPRequestHandler):
    """Answers PATHS, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        path = urlsplit(self.path).path
        if path not in PATHS:
            self.send_error(404, "this server answers %s" % sorted(PATHS))
        else:
            body = b"ok"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if PATHS[path]:
                self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps: whether the shell ever asked tells
        # "the fetch never left" from "it was answered and refused".
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True,
                        help="0 for any free one; the serving line names it")
    arguments = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), Answers)
    print("serving %s on 127.0.0.1:%d" % (sorted(PATHS), server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
