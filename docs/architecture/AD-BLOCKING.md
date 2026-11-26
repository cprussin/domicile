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
either mode. `ShouldBlock` in `components/domicile/ad_blocking/ad_blocker.cc`
has the order: an `$important` block, then the user's exception, then the
user's block, then the lists' verdict.

## Pieces

- **`components/domicile/ad_blocking`**: `AdBlocker`, the two engines and
  `ShouldBlock`, over a cxx bridge (`filter_engine.rs`) to
  [adblock-rust](https://github.com/brave/adblock-rust). adblock-rust's
  public-suffix lookups go back to Chromium's registry (`domains.cc`), so the
  engine carries one list of suffixes, not two.
- **`chrome/browser/domicile/domicile_ad_blocking.cc`**: `AdBlocking`, one
  per process, which keeps the lists and builds the blocker, and
  `ProxyAdBlocking`, which puts it in front of a frame's loads, checks each
  in its page's mode and counts what it blocks.
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
kept for a day or more; a timer checks every hour. A path is read again at
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

- a navigation of the page itself (`document`), which the user asked for;
- a worker's own loads, which have no frame;
- an Electron app's pages, the shell's, `domicile:` and `chrome-extension:`
  pages;
- a request that isn't `http(s)` or `ws(s)`.

A blocked request fails with `ERR_BLOCKED_BY_CLIENT`, which a page sees as a
network error. `--vmodule=domicile_ad_blocking=1` logs each one.

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

Not yet: the lists' `$removeparam` rules.

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

Not yet: procedural filters (`:has-text()`, `:upward()`) and scriptlets
(`##+js()`), which need a script in the page's world.

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
- [x] cosmetic filters: what the lists hide by a page's elements
- [x] tracking taken out of links to other sites
- [ ] scriptlets and procedural filters, cookie banners, `$removeparam`
- [x] fingerprinting protection: canvas, audio and processor count farbled
- [ ] farbling in workers, WebGL, fonts and the screen
