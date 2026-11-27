#!/usr/bin/env python3
"""The pages guard-ad-blocking.sh shows, at two sites.

`/page?as=ID` is the page a browser window in profile ID opens at 127.0.0.1.
It loads six scripts and logs, to the console the engine writes to its log,
which of them ran:

  GUARD ads as=ID third=X first=X mine=X allowed=X ok=X consent=X listjs=Y bannerjs=Y

each X `loaded` or `blocked`, and each Y `ran` or `none`:

  third    localhost/ads/third.js     another site's, which the list names
  first    127.0.0.1/ads/first.js     the page's own, which the list names
  mine     127.0.0.1/mine/own.js      the page's own, which the user's rule
                                      names
  allowed  localhost/ads/allowed.js   another site's, which the list names
                                      and makes an exception for
  ok       localhost/ok.js            another site's, which nothing names
  consent  localhost/consent/banner.js
                                      another site's, which only a cookie
                                      banner list names
  listjs   guardlist                  a scriptlet the list names for the
                                      page's site (127.0.0.1##+js(...))
  bannerjs guardbanner                one only a cookie banner list names

each scriptlet as the page's first script found it: whether it had run before
any of the page's own.

It also has seven elements, which the list hides by their classes and ids or
doesn't, and logs which of them are hidden once its scripts have settled and
an eighth, added a few seconds after the page loaded, has had a few seconds
more:

  GUARD hidden as=ID site=X generic=X complex=X late=X kept=X plain=X banner=X

each X `hidden` or `shown`:

  site     .site-promo     the page's site's own rule (127.0.0.1##)
  generic  .ad-banner      a generic class rule, which the page's classes are
                           asked about
  complex  div[data-ad]    a generic rule that is not a bare class or id
  late     .late-ad        a generic class rule, on an element added late
  kept     .kept           a generic class rule the site makes an exception
                           for (127.0.0.1#@#)
  plain    .plain          nothing names it
  banner   .cookie-notice  a generic class rule of a cookie banner list's only

With the hidden line it also logs what the lists' rules of other kinds did:

  GUARD rules as=ID stub=X rp=X csp=X hop=X

  stub  localhost/stub/s.js, which a `$redirect=noop.js` rule names:
        `stubbed` when the stand-in ran, `loaded` when the server's script
        did, `blocked` when neither
  rp    whether `trk`, which a `$removeparam` rule removes, reached
        localhost/echo from a fetch: `kept` or `dropped`
  csp   whether an image from localhost failed under the `$csp=img-src
        'none'` the list adds to the page: `applied` or `none`
  hop   localhost/bounce, which nothing names, redirected to
        localhost/ads/hop.js, which the list names: `blocked` or `loaded`

Then it follows a link to the other site that carries a click id and a
campaign parameter, `/landing?as=ID&keep=1&fbclid=f&utm_source=u` at
localhost, which logs what reached it:

  GUARD landed as=ID keep=X fbclid=X utm_source=X

each X `kept` or `dropped`, and then what it reads of the device:

  GUARD device as=ID cores=N canvas=H canvas_again=H image=H audio=S

the processor count, a hash of a canvas's toDataURL, again, of its
getImageData, and the sum of an OfflineAudioContext's rendering. Then it goes
to its own `#read`, so a shell sees from the address that it has logged both.

This server logs each script it is asked for, to its stdout:

  GUARD served as=ID what=WHAT

so a script that did not run because it was blocked is one the server never
served. Served over HTTP for guard-webview-guest-page.py's reason: `crux`
reaches no arbitrary host, and a bundled fixture cannot change under the
guard.
"""

import argparse
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page that loads and shows ads and says which ran</title>
    <script>
      // The page's first script: what the scriptlets did before it.
      const early = window.guardScriptlets || [];
    </script>
  </head>
  <body>
    <div class="site-promo" id="site">a site's own ad</div>
    <div class="ad-banner" id="generic">a generic ad</div>
    <div data-ad="1" id="complex">an ad by its attribute</div>
    <div class="kept" id="kept">an ad the site keeps</div>
    <div class="plain" id="plain">no ad</div>
    <div class="cookie-notice" id="banner">a cookie banner</div>
    <script>
      const as = new URLSearchParams(location.search).get("as");
      const port = location.port;
      const scripts = {
        third: `http://localhost:${port}/ads/third.js`,
        first: `http://127.0.0.1:${port}/ads/first.js`,
        mine: `http://127.0.0.1:${port}/mine/own.js`,
        allowed: `http://localhost:${port}/ads/allowed.js`,
        ok: `http://localhost:${port}/ok.js`,
        consent: `http://localhost:${port}/consent/banner.js`,
      };
      const ran = {};
      const settled = Object.entries(scripts).map(
        ([what, url]) =>
          new Promise((resolve) => {
            const script = document.createElement("script");
            script.src = `${url}?as=${as}`;
            script.onload = () => resolve([what, "loaded"]);
            script.onerror = () => resolve([what, "blocked"]);
            document.head.append(script);
          }),
      );
      // A script a `$redirect` rule answers with a stand-in, a fetch whose
      // parameter a `$removeparam` rule removes, an image the page's `$csp`
      // refuses, and a script a redirect takes to a listed address.
      const loadedScript = (url, how) =>
        new Promise((resolve) => {
          const script = document.createElement("script");
          script.src = url;
          script.onload = () => resolve(how());
          script.onerror = () => resolve("blocked");
          document.head.append(script);
        });
      const rules = Promise.all([
        loadedScript(`http://localhost:${port}/stub/s.js?as=${as}`, () =>
          window.guardStub === "stubbed" ? "stubbed" : "loaded",
        ),
        fetch(`http://localhost:${port}/echo?as=${as}&keep=1&trk=1`)
          .then((response) => response.json())
          .then((echoed) => (echoed.keys.includes("trk") ? "kept" : "dropped"))
          .catch(() => "failed"),
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve("none");
          image.onerror = () => resolve("applied");
          image.src = `http://localhost:${port}/pixel.gif?as=${as}`;
        }),
        loadedScript(
          `http://localhost:${port}/bounce?as=${as}&to=hop`,
          () => "loaded",
        ),
      ]);
      // Once every request the page makes has settled, so a count of what
      // was blocked (guard-site-privacy's) is whole when it says so.
      Promise.all([Promise.all(settled), rules]).then(([results]) => {
        for (const [what, how] of results) ran[what] = how;
        console.log(
          `GUARD ads as=${as} third=${ran.third} first=${ran.first} ` +
            `mine=${ran.mine} allowed=${ran.allowed} ok=${ran.ok} ` +
            `consent=${ran.consent} ` +
            `listjs=${early.includes("guardlist") ? "ran" : "none"} ` +
            `bannerjs=${early.includes("guardbanner") ? "ran" : "none"}`,
        );
      });
      // An ad a page adds after it loaded, as many do, then a look at what
      // is hidden once the engine has had time to gather it again.
      const loaded = new Promise((resolve) => {
        addEventListener("load", resolve);
      });
      const after = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      Promise.all([...settled, loaded, rules])
        .then(() => after(3000))
        .then(() => {
          const late = document.createElement("div");
          late.className = "late-ad";
          late.id = "late";
          late.textContent = "a late ad";
          document.body.append(late);
          return after(5000);
        })
        .then(() => {
          const how = (id) =>
            getComputedStyle(document.getElementById(id)).display === "none"
              ? "hidden"
              : "shown";
          console.log(
            `GUARD hidden as=${as} site=${how("site")} ` +
              `generic=${how("generic")} complex=${how("complex")} ` +
              `late=${how("late")} kept=${how("kept")} plain=${how("plain")} ` +
              `banner=${how("banner")}`,
          );
          return rules;
        })
        .then(([stub, rp, csp, hop]) => {
          console.log(
            `GUARD rules as=${as} stub=${stub} rp=${rp} csp=${csp} hop=${hop}`,
          );
          location.href =
            `http://localhost:${port}/landing?as=${as}&keep=1&fbclid=f&` +
            "utm_source=u";
        });
    </script>
  </body>
</html>
"""

LANDING = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page a link with tracking leads to</title>
  </head>
  <body>
    <script>
      const query = new URLSearchParams(location.search);
      const how = (name) => (query.has(name) ? "kept" : "dropped");
      const as = query.get("as");
      console.log(
        `GUARD landed as=${as} keep=${how("keep")} ` +
          `fbclid=${how("fbclid")} utm_source=${how("utm_source")}`,
      );

      // FNV-1a, as hex: enough to tell two readings apart.
      const hash = (values) => {
        let h = 0x811c9dc5;
        for (const value of values) {
          h = Math.imul(h ^ value, 0x01000193) >>> 0;
        }
        return h.toString(16);
      };
      const drawn = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 200;
        canvas.height = 50;
        const context = canvas.getContext("2d");
        context.fillStyle = "#f60";
        context.fillRect(10, 10, 100, 30);
        context.fillStyle = "#069";
        context.font = "16px sans-serif";
        context.fillText("Domicile, device details", 2, 20);
        return { canvas, context };
      };
      const exported = () =>
        hash([...drawn().canvas.toDataURL()].map((c) => c.charCodeAt(0)));
      const pixels = () => hash(drawn().context.getImageData(0, 0, 200, 50).data);
      const audio = new OfflineAudioContext(1, 5000, 44100);
      const oscillator = audio.createOscillator();
      oscillator.type = "triangle";
      oscillator.frequency.value = 10000;
      oscillator.connect(audio.destination);
      oscillator.start(0);
      audio.startRendering().then((rendered) => {
        let sum = 0;
        for (const sample of rendered.getChannelData(0)) sum += Math.abs(sample);
        console.log(
          `GUARD device as=${as} cores=${navigator.hardwareConcurrency} ` +
            `canvas=${exported()} canvas_again=${exported()} ` +
            `image=${pixels()} audio=${sum}`,
        );
        // For a shell to see the page is done, as its address.
        location.hash = "read";
      });
    </script>
  </body>
</html>
"""

SCRIPTS = {
    "/ads/third.js": "third",
    "/ads/first.js": "first",
    "/mine/own.js": "mine",
    "/ads/allowed.js": "allowed",
    "/ok.js": "ok",
    "/consent/banner.js": "consent",
    "/stub/s.js": "stub",
    "/ads/hop.js": "hop",
}

# A 1×1 transparent GIF.
PIXEL = bytes.fromhex(
    "47494638396101000100800000000000ffffff21f90401000000002c"
    "00000000010001000002024401003b"
)

# A profile id, as the config allows one. Anything else is not logged as-is.
ID = re.compile(r"^[a-z0-9-]+$")


class TwoSites(BaseHTTPRequestHandler):
    """Answers /page and the scripts, and everything else with a 404."""

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        url = urlsplit(self.path)
        as_ = parse_qs(url.query).get("as", [""])[0]
        pages = {"/page": PAGE, "/landing": LANDING}
        others = ("/echo", "/pixel.gif", "/bounce")
        if (
            url.path not in pages and url.path not in SCRIPTS and url.path not in others
        ) or not ID.match(as_):
            self.send_error(
                404, "this server has /page?as=ID, its scripts and /landing?as=ID"
            )
            return

        if url.path == "/bounce":
            # To a script the list names, which only a check of the redirect
            # blocks.
            self.send_response(302)
            self.send_header("Location", "/ads/hop.js?as=%s" % as_)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if url.path in pages:
            body = pages[url.path].encode("utf-8")
            kind = "text/html; charset=utf-8"
        elif url.path == "/echo":
            # The parameter names that reached it, for another site's fetch.
            body = json.dumps({"keys": sorted(parse_qs(url.query))}).encode()
            kind = "application/json"
        elif url.path == "/pixel.gif":
            body = PIXEL
            kind = "image/gif"
        else:
            print("GUARD served as=%s what=%s" % (as_, SCRIPTS[url.path]), flush=True)
            body = b"// a script that ran\n"
            kind = "text/javascript"
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        # For the other site's fetch of /echo.
        self.send_header("Access-Control-Allow-Origin", "*")
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
