// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_AD_BLOCKING_AD_BLOCKER_H_
#define COMPONENTS_DOMICILE_AD_BLOCKING_AD_BLOCKER_H_

#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "base/time/time.h"
#include "services/network/public/mojom/fetch_api.mojom-shared.h"
#include "url/gurl.h"

namespace domicile {

// adblock-rust's name for a request's type, as filter options such as
// `$script` and `$image` name it, from what the request fetches.
std::string_view AdBlockRequestType(network::mojom::RequestDestination);

// Blocks ads and trackers as Brave does, with Brave's filter engine
// (adblock-rust) over filter lists in Adblock Plus and uBlock Origin syntax.
// See docs/architecture/AD-BLOCKING.md.
//
// Two engines, as Brave keeps them: one for the lists and one for the user's
// own rules, so a mode that lets a site's own requests through can still
// apply the user's rules to them, and a rule of the user's can make an
// exception to a list's. A third holds the cookie banner lists, which apply
// as the lists do, but only to a page that hides cookie banners. Each has
// the scriptlets its `##+js(...)` rules run.
//
// Immutable once built. Building is slow (tens of milliseconds for EasyList,
// EasyPrivacy and uBlock Origin's filters), so it is built on a worker and
// asked where requests start.
class AdBlocker {
 public:
  // What to do with one request. See Decide.
  struct Decision {
    enum class Kind {
      kAllow,
      kBlock,
      // Answer with `url`, the `data:` URL of a `$redirect` rule's stand-in,
      // instead of loading.
      kRedirect,
      // Load `url`, the request's less what `$removeparam` rules remove.
      kRewrite,
    };

    // Whether the request is kept from the network.
    bool blocks() const {
      return kind == Kind::kBlock || kind == Kind::kRedirect;
    }

    friend bool operator==(const Decision&, const Decision&) = default;

    Kind kind = Kind::kAllow;
    GURL url;
  };

  // What a page at one address hides by its elements (cosmetic filters, as
  // `##.ad` and `example.com##.promo`), before its classes and ids are known.
  struct Cosmetics {
    Cosmetics();
    Cosmetics(Cosmetics&&);
    Cosmetics& operator=(Cosmetics&&);
    ~Cosmetics();

    // CSS selectors to hide, from the lists and the user's rules: the site's
    // own and the generic ones that aren't a bare class or id. In order,
    // without repeats.
    std::vector<std::string> hide_selectors;
    // Class and id selectors (`.ad`) the site's rules except from the
    // generic ones, for HiddenClassIdSelectors.
    std::vector<std::string> exceptions;
    // A `$generichide` exception matched: no generic rule applies, so the
    // page's classes and ids need no asking about.
    bool generichide = false;
    // The scriptlets the page's `##+js(...)` rules run, as one script for
    // its main world before its own: empty when none do.
    std::string script;
  };

  // One of adblock-rust's resources, as its resources file holds it: a
  // scriptlet a `##+js(name, ...)` rule runs, or one it needs.
  struct Scriptlet {
    Scriptlet();
    Scriptlet(const Scriptlet&);
    Scriptlet(Scriptlet&&);
    Scriptlet& operator=(const Scriptlet&);
    Scriptlet& operator=(Scriptlet&&);
    ~Scriptlet();

    // Its name, such as `set-constant.js` or `safe-self.fn`, and others a
    // rule may name it by.
    std::string name;
    std::vector<std::string> aliases;
    // Its MIME type: `application/javascript` for a template a rule's
    // arguments fill in, `fn/javascript` for a function a rule calls with
    // them, as uBlock Origin's are.
    std::string kind;
    // Its text, in base64.
    std::string content;
    // The names of the scriptlets it needs, which go into the page with it.
    std::vector<std::string> dependencies;
  };

  // The scriptlets in an adblock-rust resources file's text, a JSON array of
  // resources, with the stand-ins `$redirect` rules answer with; nothing when
  // it is not one. A type adblock-rust doesn't serve is left out, and so is
  // one that needs a permission, which no list is given.
  static std::optional<std::vector<Scriptlet>> ScriptletsIn(
      std::string_view text);

  // `lists` and `cookie_banner_lists` are filter lists' texts, each valid
  // UTF-8; `rules` the user's own rules, one per entry; `scriptlets` what
  // their `##+js(...)` rules may run.
  static std::unique_ptr<AdBlocker> Build(
      const std::vector<std::string>& lists,
      const std::vector<std::string>& rules,
      const std::vector<std::string>& cookie_banner_lists,
      const std::vector<Scriptlet>& scriptlets);

  AdBlocker(const AdBlocker&) = delete;
  AdBlocker& operator=(const AdBlocker&) = delete;
  ~AdBlocker();

  // Whether to block a `method` request for `url`, of AdBlockRequestType
  // `type`, from the page at `page`, the top-level document's address.
  //
  // A request to another site than the page's (by registrable domain, as
  // cookies count sites) is blocked when a list or the user's rules name it.
  // One to the page's own site is blocked when the user's rules name it, a
  // list's `$important` rule does, or `block_first_party` (Strict) is set and
  // a list does. No exception lifts an `$important` rule; the user's
  // exceptions lift the lists' other rules. With `hide_cookie_banners`, the
  // cookie banner lists count as lists.
  bool ShouldBlock(const GURL& url,
                   const GURL& page,
                   std::string_view type,
                   std::string_view method,
                   bool block_first_party,
                   bool hide_cookie_banners) const;

  // ShouldBlock's verdict, with what a blocking rule's `$redirect` answers
  // instead, when the blocker has that stand-in, and what an allowed
  // request's `$removeparam` rules remove. A list's `$removeparam` applies
  // where a list's block would, the user's everywhere, and only a GET or
  // HEAD is rewritten: a redirect would send a body again.
  Decision Decide(const GURL& url,
                  const GURL& page,
                  std::string_view type,
                  std::string_view method,
                  bool block_first_party,
                  bool hide_cookie_banners) const;

  // The `Content-Security-Policy` the lists' and the user's `$csp` rules add
  // to the response for `url`, a document or frame of AdBlockRequestType
  // `type` in the page at `page`, or empty for none: the cookie banner
  // lists' too with `hide_cookie_banners`. Several are joined by commas, one
  // policy each, all enforced.
  std::string CspDirectives(const GURL& url,
                            const GURL& page,
                            std::string_view type,
                            std::string_view method,
                            bool hide_cookie_banners) const;

  // How long a filter list's `text` says to keep it before it is fetched
  // again (`! Expires: 4 days`), or nothing when it says nothing.
  static std::optional<base::TimeDelta> ListExpiry(std::string_view text);

  // What the page at `page` hides, the cookie banner lists' too with
  // `hide_cookie_banners`. See docs/architecture/AD-BLOCKING.md.
  Cosmetics CosmeticsFor(const GURL& page, bool hide_cookie_banners) const;

  // The generic rules' selectors for a page's `classes` and `ids`, without
  // their `.` or `#`, but those in `exceptions` (Cosmetics::exceptions), the
  // cookie banner lists' too with `hide_cookie_banners`. In order, without
  // repeats.
  std::vector<std::string> HiddenClassIdSelectors(
      const std::vector<std::string>& classes,
      const std::vector<std::string>& ids,
      const std::vector<std::string>& exceptions,
      bool hide_cookie_banners) const;

 private:
  struct Engines;
  explicit AdBlocker(std::unique_ptr<Engines> engines);

  const std::unique_ptr<Engines> engines_;
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_AD_BLOCKING_AD_BLOCKER_H_
