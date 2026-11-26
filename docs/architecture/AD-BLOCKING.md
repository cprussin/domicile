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
  `ProxyAdBlocking`, which puts it in front of a frame's loads.
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

`guard-ad-blocking.sh` checks what a page loads in each mode.

## Key decisions

- **In the engine over an extension** (uBlock Origin Lite): no rule cap, no
  extension sees the request first, and a private profile is covered without
  allowing an extension in it.
- **adblock-rust over a filter engine of our own**: Brave's, maintained, and
  it reads uBlock Origin's syntax, so the lists people already use work.
- **Network rules only, for now.** Cosmetic filters and scriptlets need the
  renderer; they come with their own guard.
- **Standard by default, strict in private**, as the mockup settled: strict's
  breakage is a site's own scripts, which a person in a private window is
  likelier to accept.

## Plan

- [x] the config's lists and rules, and each profile's mode
- [x] the blocker in front of every website request, lists fetched and kept
- [x] Settings › Privacy chooses the mode per profile
- [ ] the address bar's shield: what a page had blocked, and off for a site
      or for "This window only", through the SDK for any shell
- [ ] cosmetic filters, scriptlets, cookie banners and tracking removed from
      links
- [ ] fingerprinting protection
