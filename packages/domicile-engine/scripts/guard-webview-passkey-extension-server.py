#!/usr/bin/env python3
"""The page guard-webview-passkey-extension.sh asks for a passkey from.

One path, `/page`: a document that first has a sandboxed frame -- an opaque
origin -- ask isUserVerifyingPlatformAuthenticatorAvailable(), which took the
browser down until patch 0069; then calls navigator.credentials.create() and
paints what came back, each in one flat color the guard reads:

  --unheld     asked as `/page?conditional`, before anything else: the browser
               said there is no conditional UI, or answered a conditional
               get() rather than holding it until it was aborted (patch 0083)

  --answered   the fixture extension's answer, by its message
  --refused    any other refusal; it asks again a second later, because the
               extension attaches after startup and may lose the race
  --no-api     no PublicKeyCredential at all, so it never asks

and `--color` until one of them does. Each outcome is also a `GUARD` console
line, which the engine's log keeps.

Served from 127.0.0.1 and opened as `localhost`: an IP address is no relying
party WebAuthn will take, and `localhost` is one that needs no certificate.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PAGE_PATH = "/page"

# The fixture's `ANSWER`: scripts/test-webview-passkey-extension-guard.sh
# holds the two together.
ANSWER = "domicile-guard-passkey-extension"

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page that asks for a passkey</title>
    <style>
      html,
      body {{
        background: #{color};
        block-size: 100%;
        inline-size: 100%;
        margin: 0;
        padding: 0;
      }}
    </style>
  </head>
  <body>
    <script>
      const HELD_FOR_MS = 2000;

      const paint = (color) => {{
        document.documentElement.style.background = `#${{color}}`;
        document.body.style.background = `#${{color}}`;
      }};

      const ask = () => {{
        navigator.credentials
          .create({{
            publicKey: {{
              challenge: new Uint8Array(32),
              pubKeyCredParams: [{{ alg: -7, type: "public-key" }}],
              rp: {{ id: "localhost", name: "guard" }},
              user: {{
                displayName: "guard",
                id: new Uint8Array(16),
                name: "guard",
              }},
            }},
          }})
          .then(
            () => {{
              console.log("GUARD created");
            }},
            (error) => {{
              if (error.message === "{answer}") {{
                console.log("GUARD answered");
                paint("{answered}");
              }} else {{
                console.log(`GUARD refused ${{error.name}}: ${{error.message}}`);
                paint("{refused}");
                setTimeout(ask, 1000);
              }}
            }},
          );
      }};

      // A fraud-detection script asks from a sandboxed frame, so its origin is
      // opaque. The browser has to answer it before the page asks anything.
      const askFromAnOpaqueOrigin = () => {{
        window.addEventListener(
          "message",
          (event) => {{
            console.log(`GUARD opaque frame told ${{event.data}}`);
            ask();
          }},
          {{ once: true }},
        );
        const frame = document.createElement("iframe");
        frame.hidden = true;
        frame.sandbox = "allow-scripts";
        frame.srcdoc =
          "<script>PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()" +
          '.then((available) => parent.postMessage(available, "*"));<\\/script>';
        document.body.append(frame);
      }};

      // A site starts a conditional get() for a passkey extension's autofill
      // to answer. With nothing to answer it, the browser must hold it until
      // the site aborts it: a refusal is what a racing extension loses to.
      const askConditionally = async () => {{
        if (await PublicKeyCredential.isConditionalMediationAvailable()) {{
          await askHeld();
        }} else {{
          console.log("GUARD unheld: no conditional mediation");
          paint("{unheld}");
        }}
      }};

      const askHeld = async () => {{
        const abort = new AbortController();
        const settled = navigator.credentials
          .get({{
            mediation: "conditional",
            publicKey: {{ challenge: new Uint8Array(32), rpId: "localhost" }},
            signal: abort.signal,
          }})
          .then(
            () => "answered",
            (error) => error.name,
          );
        const held = new Promise((resolve) => {{
          setTimeout(() => resolve("held"), HELD_FOR_MS);
        }});
        const first = await Promise.race([settled, held]);
        abort.abort();
        const outcome = first === "held" ? await settled : `settled ${{first}}`;
        if (outcome === "AbortError") {{
          console.log("GUARD conditional held until aborted");
          askFromAnOpaqueOrigin();
        }} else {{
          console.log(`GUARD unheld: ${{outcome}}`);
          paint("{unheld}");
        }}
      }};

      if (typeof PublicKeyCredential !== "function") {{
        console.log("GUARD no PublicKeyCredential");
        paint("{no_api}");
      }} else if (location.search === "?conditional") {{
        askConditionally().catch((error) => {{
          console.log(`GUARD unheld: ${{error}}`);
          paint("{unheld}");
        }});
      }} else {{
        askFromAnOpaqueOrigin();
      }}
    </script>
  </body>
</html>
"""


class OnePage(BaseHTTPRequestHandler):
    """Answers `/page`, and everything else with a 404."""

    # Set by main(): BaseHTTPRequestHandler is instantiated per request.
    body = b""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        if urlsplit(self.path).path == PAGE_PATH:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(self.body)))
            # So no leg is answered out of another's HTTP cache.
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(self.body)
        else:
            self.send_error(404, "this server has one page and that is not it")

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps: whether the page was requested at
        # all tells "the guest never asked" from "it loaded and never painted".
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--port",
        type=int,
        required=True,
        help="0 for any free one; the serving line names the one taken",
    )
    for name in ("color", "answered", "refused", "no-api", "unheld"):
        parser.add_argument("--" + name, required=True, help="RRGGBB, no leading #")
    arguments = parser.parse_args()

    OnePage.body = PAGE.format(
        answer=ANSWER,
        answered=arguments.answered,
        color=arguments.color,
        no_api=arguments.no_api,
        refused=arguments.refused,
        unheld=arguments.unheld,
    ).encode("utf-8")
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), OnePage)
    # Before serve_forever, so a guard waiting on this line is not waiting on a
    # buffer. lib-ports.sh's served_port reads the port off it.
    print("serving %s on 127.0.0.1:%d" % (PAGE_PATH, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
