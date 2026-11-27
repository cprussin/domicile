# Ad and tracker blocking

The engine blocks ads and trackers itself, as Brave does, rather than through
an extension: every request a website's page makes is checked against the
config's filter lists before it reaches the network, in the mode of the
profile the page is in. An extension's `declarativeNetRequest` is capped at a
fraction of a list's rules and can't see a request before another extension
does; the engine has neither limit.

## The config

- **`browser.block_lists`**: the filter lists, in Adblock Plus syntax, each
  an `https:` address or an absolute path. Unset: EasyList, EasyPrivacy and
  uBlock Origin's own filters (`DEFAULT_BLOCK_LISTS` in `domicile-config`).
  `[]` fetches none.
- **`browser.block_rules`**: rules of the user's own, in the same syntax,
  which apply on top of the lists.
- **`browser.cookie_banner_lists`**: the lists cookie banners are hidden
  with, the same way. Unset: the EasyList Cookie List and uBlock Origin's
  cookie notices (`DEFAULT_COOKIE_BANNER_LISTS`). `[]` hides none.
- **`browser.scriptlet_resources`**: the scriptlets the lists' `##+js(...)`
  rules run, as adblock-rust's resources file: an `https:` address, which
  may end in `#sha256=` and the file's hash, or an absolute path. Unset:
  uBlock Origin's, as CI builds them (`DEFAULT_SCRIPTLET_RESOURCES`, see
  [Scriptlets](#scriptlets)). `null` runs none.
- **`browser.block_in_electron_apps`**: also blocks in an Electron app's web
  pages, in Standard, with the lists' cosmetic filters, as an app's page is
  in no profile and has no shield. Off unless set: an app can break in ways
  no shield fixes.
- **A profile's `protections.block_ads_and_trackers`**: `standard`, `strict`
  or `off`. Unset: `standard`, or `strict` in a private profile.

A page's mode is its window's, else its site's, else its profile's. A shell
sets the first two ([SHELL-BROWSER-WINDOWS.md](../SHELL-BROWSER-WINDOWS.md#ads-and-trackers)):

- **A site's** is kept in its profile's prefs (`domicile.ad_blocking.sites`,
  `site_privacy.h`), by registrable domain, so `www.` and `m.` are one site.
  A private profile's goes with its off-the-record profile.
- **A window's** is kept on its page's WebContents (`page_privacy.h`) until
  the window closes. A shield's "This window only" is a quick fix that ends
  by itself, so it never outlives what it fixed.

Each protection beside it, a profile's `hide_device_details`,
`remove_tracking_from_links` and `hide_cookie_banners` (`PageProtection`), is
the same: its window's,
else its site's (`domicile.privacy.sites`, by name), else its profile's, and
off on any page whose mode is `off`, so turning a site's shield off turns off
everything it stands for. `PagePrivacy::IsOnFor` answers for a navigation
before it commits, which both checks need: the link check before it follows a
link, device hiding before the page's first script.

The compositor hands all three to the engine with the profiles
(`HostMessage::BrowserProfiles`).

## Modes

| Mode       | Blocks                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `standard` | what the lists name from another site than the page's, and anything `$important` or the user's |
| `strict`   | what the lists name from any site, the page's own too                                           |
| `off`      | nothing                                                                                         |

"Another site" is another registrable domain (`net::registry_controlled_domains`,
private registries included), as adblock-rust's `$third-party` has it.
Standard is Brave's default: a site's own ads and analytics are where most of
the breakage strict causes comes from.

The user's rules are a second engine beside the lists', as in Brave, so their
exceptions (`@@`) can unblock what a list blocks, and their blocks apply in
either mode. `Decide` in `components/domicile/ad_blocking/ad_blocker.cc`
has the order: an `$important` block, then the user's exception, then the
user's block, then the lists' verdict, and a `$removeparam` rewrite only for
a request nothing blocks.

## Pieces

- **`components/domicile/ad_blocking`**: `AdBlocker`, its engines and
  `Decide`, over a cxx bridge (`filter_engine.rs`) to
  [adblock-rust](https://github.com/brave/adblock-rust). adblock-rust's
  public-suffix lookups go back to Chromium's registry (`domains.cc`), so the
  engine carries one list of suffixes, not two.
- **`chrome/browser/domicile/domicile_ad_blocking.cc`**: `AdBlocking`, one
  per process, which keeps the lists and builds the blocker, and
  `ProxyAdBlocking`, which puts an `AdBlockingLoader` in front of each of a
  frame's loads, checks it in its page's mode and counts what it blocks.
- **`components/domicile/browser/page_privacy.h`**: a page's mode and count,
  which its `<webview>` reports (`SitePrivacyChanged`).
- **`components/domicile/renderer/cosmetic_filters.h`**: a frame's cosmetic
  filters, in the renderer (see [What is hidden](#what-is-hidden)). Patch 0292
  gives every frame one, from `ChromeContentRendererClient::RenderFrameCreated`.
- **Patch 0287**: `ChromeContentBrowserClient::WillCreateURLLoaderFactory`
  calls `ProxyAdBlocking`, after an Electron app's handlers and before
  extensions' webRequest, so a blocked request reaches no extension.
- **Crates**: adblock-rust and the crates it needs that the Chromium pin does
  not vendor are named, with their sha256, in
  `packages/domicile-engine/crates/CRATES`. `engine-crates.sh` lays them down
  in the checkout at apply time; `generate-build-files.py` writes their
  `BUILD.gn`.

## Lists

An `https:` list is fetched through the system's network context, with no
profile's cookies, and kept in the user data directory's
`domicile-block-lists`, by the sha256 of its address. A start builds from
what it kept, so blocking is up before the network is, then fetches any list
kept longer than its `! Expires:` says (`AdBlocker::ListExpiry`; EasyList's
is 4 days), or a day when it names none; a timer checks every hour. A path is read again at
each change of the config. A list that can't be read, or isn't UTF-8, is
left out, and an error names it.

Building is off the UI thread. The lists' rules, about 100,000, build in
under 100 ms, and a check takes about 2 µs, so there is no cache of the built
engine. Requests that start while a config's lists are first read and built
wait for the build, so a page restored at start is blocked like any other. A
rebuild after a fetch keeps the old blocker until the new one is up.

## What is checked

Every request a frame of a website's page makes: subresources, frames,
fetches and WebSockets, whose page is the frame's tab's main page. Not:

- a navigation of the page itself (`document`), which the user asked for,
  though its response gets the lists' `$csp`;
- a worker's own loads, which have no frame;
- an Electron app's pages, unless `browser.block_in_electron_apps`; the
  shell's, `domicile:` and `chrome-extension:` pages;
- a request that isn't `http(s)` or `ws(s)`.

A blocked request fails with `ERR_BLOCKED_BY_CLIENT`, which a page sees as a
network error. `--vmodule=domicile_ad_blocking=1` logs each one.

Each checked request goes through an `AdBlockingLoader`, which acts on
`AdBlocker::Decide`:

- **`$redirect`**: a blocked request whose rule names a resource is answered
  with that stand-in (`noop.js`, a 1×1 GIF) from the resources file, as
  Brave's `MakeStubResponse` does, so a page that waits for the script still
  runs. It counts as blocked. Without the resource it is only blocked.
- **`$removeparam`**: an allowed GET or HEAD whose rules remove parameters is
  redirected to the address without them before the network sees it, as an
  extension's webRequest redirect is. A list's applies where a list's block
  would (another site's request, or any in Strict); the user's everywhere.
- **`$csp`**: a document's or frame's response gets the
  `Content-Security-Policy` the lists' and the user's rules add, and the
  cookie banner lists' where cookie banners are hidden, as Brave adds it; a
  frame tree's own navigation is checked in the mode of the page it goes to.
- **A server's redirect** is checked as a new request: one to a blocked
  address fails.
- **CNAME uncloaking**: a request nothing blocked, that the lists could
  block (another site's, or any in Strict), is checked again under the
  canonical name its host resolves to, as Brave does, so a tracker a site
  serves from a subdomain of its own (`metrics.news.example` →
  `news.example.tracker.example`) is blocked. The name is asked of the
  frame's network context, keyed as the frame's own requests are. Not
  behind a proxy, where the name here is not the one the request reaches
  and a lookup would tell the DNS server what the proxy hides, and not for
  an address that is an IP.

`guard-ad-blocking.sh` checks what a page loads and hides in each mode.

## What is hidden

The lists also hide ads by their elements: `##.ad-banner` anywhere,
`example.com##.promo` on one site, `example.com#@#.ad-banner` to keep one on
a site, and `@@||example.com^$generichide` to keep every generic one off it.
They hide the same in Standard and Strict; Off hides nothing.

- **Before a page commits**, `CosmeticFiltering` (in
  `domicile_ad_blocking.cc`) asks the blocker what the page's address hides
  (`AdBlocker::CosmeticsFor`) and sends it to the frame's renderer
  (`mojom::CosmeticFilters.Hide`), over an associated interface, so it gets
  there before the commit does. Each frame of a website's page gets its own,
  by its own address, in its page's mode.
- **In the renderer**, `components/domicile/renderer/cosmetic_filters.h`
  puts it in the new document as a user stylesheet, each selector its own
  `display: none !important` rule, as the document element is made: it
  applies from the first style, and the page's own `!important` can't undo
  it. A selector with `{` or `}` in it is dropped.
- **Generic class and id rules** are tens of thousands, so they aren't sent.
  The renderer gathers the document's classes and ids once it has parsed,
  once it has loaded and every 2 seconds for 30 seconds after, as pages add
  ads late, and asks the browser (`CosmeticFiltersHost.HiddenSelectors`)
  about those it hasn't asked about before; what comes back goes in another
  stylesheet. The host keeps the site's exceptions, and asks the blocker of
  the moment. A `$generichide` page gets no host.

With EasyList, EasyPrivacy and uBlock Origin's filters, a news site's page
gets about 450 selectors, found in well under a millisecond.

## Links

A link from one site to another often carries the click that brought it
(`?fbclid=`, `gclid`, `msclkid`, Brave's list of about 60), which tells the
site, and whoever it shares it with, where you came from. In a profile with
`protections.remove_tracking_from_links` (on unless set `false`), in Standard
and Strict, `LinkTrackingThrottle`
(`components/domicile/browser/link_tracking_throttle.h`) cancels such a
navigation, or its redirect, and starts it again without them
(`WithoutTracking`); Strict drops the campaign parameters (`utm_`) too. Off
keeps everything. It leaves alone a link within one site, whose parameters
may be its own, a frame's navigation, a POST, back, forward and reload, and
an Electron app's page. `--vmodule=link_tracking_throttle=1` logs each one.

The lists' `$removeparam` rules apply to a page's requests ([What is
checked](#what-is-checked)), not to its navigation.

## Cookie banners

A profile with `protections.hide_cookie_banners` (on unless set `false`)
checks its pages against the cookie banner lists too, in Standard and Strict,
as Brave does with the EasyList Cookie List: a third engine beside the lists'
and the user's (`AdBlocker`), fetched and kept as the lists are. Its network
rules block a consent manager's scripts as the lists' do, another site's in
Standard and any in Strict, and its element rules hide the banner and the
dimmed page behind it. Its exceptions are its own: an `@@` in the cookie list
lifts only the cookie list's rules, as one in EasyList lifts only EasyList's.

Hiding a banner answers nothing, so a page that waits for consent before it
sets its trackers' cookies never sets them. A page that locks its scrolling
under the banner is unlocked by the cookie list's scriptlets, which run only
where the protection is on.

## Scriptlets

Some ads and banners can't be hidden by a selector or blocked by an address:
a page that refuses to show itself until its ad script ran, or locks its
scrolling under a banner. The lists answer those with scriptlets,
`example.com##+js(set-constant, adsLoaded, true)`: a small script of uBlock
Origin's, called with the rule's arguments in the page's own world before
any of its scripts.

- **Where they come from.** uBlock Origin's scriptlets are GPL-3.0, so they
  are not in the engine. `.github/scripts/scriptlet-resources.sh` clones
  uBlock Origin at a pinned version and commit, and
  `scriptlet-resources.ts` writes each function of `builtinScriptlets` as an
  adblock-rust resource, leaving out those that need a trusted list
  (`requiresTrust`, which Domicile has none of). Those uBlock Origin runs in
  its isolated world, such as `remove-class` and `set-cookie`, run in the
  page's world, as Brave runs them. CI (`.github/workflows/scriptlets.yml`) publishes it once per
  version as a release in `cprussin/domicile-builds`, apart from Domicile's
  code, and checks a pull request's pin against what it builds, or against
  the release once it is there.
- **How the engine gets them.** `browser.scriptlet_resources` names the
  file, by default that release pinned by its sha256. `AdBlocking` fetches
  and keeps it as it does a list, and drops a fetched or kept copy whose
  hash is not the pin, so it runs nothing but what CI built.
  `AdBlocker::ScriptletsIn` reads it and each engine, the lists', the
  user's rules' and the cookie lists', gets the scriptlets
  (`use_scriptlets`).
- **How a page runs them.** `CosmeticsFor` asks each engine for the site's
  `injected_script`, adblock-rust's calls of the scriptlets the site's rules
  name, each wrapped in a `try`, with what they depend on. The Hide that
  carries the page's cosmetic filters carries it too, and the renderer's
  `CosmeticFilters` executes it in the main world at document start
  (`RunScriptsAtDocumentStart`, patch 0297), before the page's first script
  and before extensions' `document_start` scripts, in a function that
  defines the `scriptletGlobals` uBlock Origin's scriptlets read, empty as
  Brave's is. Blink runs no script while it tells a frame's observers the
  document element exists, so the stylesheet goes in there and the
  scriptlets just after.

The same file holds the stand-ins `$redirect` rules answer with ([What is
checked](#what-is-checked)): each engine gets every resource of a type
adblock-rust serves, not only scriptlets. CI's release carries uBlock Origin's
scriptlets only, so until it carries their redirect resources too, a
`$redirect` rule only blocks.

Only a site's own `##+js` rules run, as in uBlock Origin; `#@#+js(...)`
lifts one on a site. A page whose mode is off, or a frame the browser sends
no Hide to, runs none. `--vmodule=domicile_ad_blocking=1` logs the scriptlets
a page runs with its cosmetic filters.

## Device details

A site can recognize a browser without a cookie by what it reads of the
device: how a canvas drawing comes out in pixels, how an audio graph renders,
how many processors there are. In a profile with
`protections.hide_device_details` (on unless set `false`), in Standard and
Strict, a page reads each a little off, as Brave farbles them:

- **Canvas**: `toDataURL`, `toBlob` and `getImageData` change the lowest bit
  of one color in 8 of the picture's pixels (`FarblePixels`), chosen by the
  seed and the pixels, so the same drawing comes out the same way twice.
- **Audio**: what an `OfflineAudioContext` renders, and an `AnalyserNode`'s
  float readings, are scaled by a factor a few millionths from 1
  (`FarbledAudioFactor`).
- **Processors**: `navigator.hardwareConcurrency` is between 2 and the true
  count (`FarbledHardwareConcurrency`).

The seed is the first 8 bytes of an HMAC-SHA256 of the page's top site, keyed
by 32 random bytes each profile draws when it starts (`DeviceDetailsHiding`,
`chrome/browser/domicile/domicile_device_details.cc`). So one site reads the
same details all session, two sites read different ones, and the next start
reads new ones. The browser pushes it to the frame before its commit, as it
does cosmetic filters (`DeviceDetailsAgent`), and Blink keeps it on the
`LocalDOMWindow`; a frame reads its nearest local parent's. Patch 0293 calls
the farbling (`third_party/blink/renderer/core/frame/domicile_device_details.h`)
from each of those places. Off reads the truth.

Not yet: workers (their `hardwareConcurrency` and `OffscreenCanvas`), WebGL's
`readPixels`, `OffscreenCanvas.convertToBlob`, an `AnalyserNode`'s byte
readings, an `AudioContext` played rather than rendered offline, and fonts and
the screen's size.

Not yet: procedural filters (`:has-text()`, `:upward()`).

## Key decisions

- **In the engine over an extension** (uBlock Origin Lite): no rule cap, no
  extension sees the request first, and a private profile is covered without
  allowing an extension in it.
- **adblock-rust over a filter engine of our own**: Brave's, maintained, and
  it reads uBlock Origin's syntax, so the lists people already use work.
- **Cosmetic filters pushed before the commit, as a user stylesheet.** Brave
  asks from the renderer once the document exists, which can show an ad for a
  frame; a push over an associated interface is there first, and a user
  stylesheet beats the page's `!important`.
- **Click ids in Standard, campaign parameters only in Strict**, as Brave:
  `utm_` names a newsletter or an ad campaign, not you, and some sites read
  it for their own pages.
- **Farbled, not blocked or made uniform.** A canvas or audio reading that
  fails breaks the sites that draw or play with them; one made the same for
  everyone needs everyone on the same engine, which a desktop of its own is
  not. A few bits off, per site and per start, are invisible and still keep
  two sites from matching their readings.
- **The same hiding in Standard and Strict.** The lists' cosmetic rules
  rarely break a site the way blocking its own scripts does, so Strict only
  blocks more.
- **uBlock Origin's scriptlets built in CI and fetched, not bundled.** They
  are GPL-3.0 and the engine is MIT, and they change with the lists; a
  release of their own, pinned by hash, keeps them apart and lets a fix
  reach people without an engine release.
- **Standard by default, strict in private**, as the mockup settled: strict's
  breakage is a site's own scripts, which a person in a private window is
  likelier to accept.

## Plan

- [x] the config's lists and rules, and each profile's mode
- [x] the blocker in front of every website request, lists fetched and kept
- [x] Settings › Privacy chooses the mode per profile
- [x] each page's count, and a mode for its site or its window, for any
      shell (`view.blockAdsAndTrackers`, `setBlockAdsAndTrackers`)
- [x] manganese's shield in the address bar, with "This window only"
- [x] Settings lists the sites with their own mode (`site_privacy`)
- [x] each protection on or off for a site or a window
      (`setPrivacyProtection`), and listed in Settings
- [x] cosmetic filters: what the lists hide by a page's elements
- [x] tracking taken out of links to other sites
- [x] cookie banners hidden with their own lists, a protection of their own
- [x] scriptlets, uBlock Origin's, built in CI and pinned by hash
- [x] `$redirect`, `$removeparam`, `$csp`, redirects and CNAME uncloaking
- [x] each list kept as long as its `! Expires:` says
- [x] Electron apps' pages, when the config asks
- [ ] procedural filters
- [x] fingerprinting protection: canvas, audio and processor count farbled
- [ ] farbling in workers, WebGL, fonts and the screen
