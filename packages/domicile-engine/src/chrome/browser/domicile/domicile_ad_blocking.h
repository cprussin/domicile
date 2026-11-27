// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef CHROME_BROWSER_DOMICILE_DOMICILE_AD_BLOCKING_H_
#define CHROME_BROWSER_DOMICILE_DOMICILE_AD_BLOCKING_H_

#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/callback_forward.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/time/time.h"
#include "base/timer/timer.h"

namespace content {
class RenderFrameHost;
class WebContents;
}  // namespace content

namespace network {
class SimpleURLLoader;
class URLLoaderFactoryBuilder;
}  // namespace network

namespace domicile {

class AdBlocker;

// The desk's ad and tracker blocking: the config's filter lists, cookie
// banner lists and scriptlets, kept up to date, built into one AdBlocker,
// which every website's requests are checked against in the mode of the
// profile its page is in. See docs/architecture/AD-BLOCKING.md.
//
// - An `https:` list is fetched through the system's network context, with
//   no profile's cookies, and kept in the user data directory's
//   `domicile-block-lists`. A start reads what it kept, so blocking is up
//   before the network is, and fetches again a list kept for a day or more,
//   checking every hour.
// - A path is read at each change of the config.
// - A list that cannot be read, or is not UTF-8 text, is left out, and an
//   error names it.
// - The scriptlets are read and fetched as a list is. Pinned by an
//   address's `#sha256=`, a file that is not that one is neither used nor
//   kept, and the one kept is not fetched again.
//
// Requests that start while the config's lists are first read and built wait
// for it, so a page restored at start is blocked like the rest. A rebuild
// after a fetch keeps the old blocker until the new one is up.
//
// One per process. UI thread only.
class AdBlocking {
 public:
  static AdBlocking& Get();

  AdBlocking(const AdBlocking&) = delete;
  AdBlocking& operator=(const AdBlocking&) = delete;

  // The config's `browser.block_lists`, `browser.block_rules`,
  // `browser.cookie_banner_lists` and `browser.scriptlet_resources`. Reads
  // and builds again when they changed.
  void Configure(std::vector<std::string> lists,
                 std::vector<std::string> rules,
                 std::vector<std::string> cookie_banner_lists,
                 std::optional<std::string> scriptlet_resources);

  // Runs `ready` once the blocker for the config is up: at once, unless the
  // config's lists are being read and built for the first time.
  void WhenReady(base::OnceClosure ready);

  // The blocker for the config, or null while there is none: before the
  // config, and for one with no lists and no rules.
  const AdBlocker* blocker() const { return blocker_.get(); }

 private:
  friend class base::NoDestructor<AdBlocking>;
  AdBlocking();
  ~AdBlocking();

  // What a read of the config's lists found: each list's text, by list, and
  // when each `https:` one was kept.
  struct Read {
    Read();
    Read(Read&&);
    Read& operator=(Read&&);
    ~Read();

    std::map<std::string, std::string> texts;
    std::map<std::string, base::Time> kept;
  };

  // Every list the config names, the cookie banner lists and the scriptlet
  // resources' address too: each is read, fetched and kept alike.
  std::vector<std::string> AllLists() const;
  // Whether `list` is one the config names.
  bool Names(const std::string& list) const;
  // The texts in hand of `lists`, in their order.
  std::vector<std::string> TextsOf(const std::vector<std::string>& lists) const;

  void Started(int generation, Read read);
  // Builds the blocker from the texts in hand, for `generation`.
  void Rebuild();
  void Built(int build, std::unique_ptr<AdBlocker> blocker);
  // Fetches each `https:` list kept for a day or more, or not kept.
  void FetchStale();
  void Fetched(const std::string& list,
               std::unique_ptr<network::SimpleURLLoader> loader,
               std::optional<std::string> body);

  base::FilePath kept_dir_;
  std::vector<std::string> lists_;
  std::vector<std::string> rules_;
  std::vector<std::string> cookie_banner_lists_;
  // `browser.scriptlet_resources` without its `#sha256=` pin, and the pin,
  // lowercase, if it has one.
  std::optional<std::string> scriptlets_;
  std::optional<std::string> scriptlets_pin_;
  bool configured_ = false;
  // Bumped on each change of the config, so an answer for an older one is
  // dropped.
  int generation_ = 0;
  // Bumped by each `Rebuild` and each change of the config. `Built` takes
  // only the latest build's blocker: lists fetched together each rebuild, and
  // an older build, of fewer lists, can finish last.
  int build_ = 0;
  // Whether the blocker is for the config: false from a change until its
  // first build is up.
  bool ready_ = true;
  std::vector<base::OnceClosure> waiting_;
  std::map<std::string, std::string> texts_;
  std::map<std::string, base::Time> kept_;
  std::set<std::string> fetching_;
  std::unique_ptr<AdBlocker> blocker_;
  base::RepeatingTimer refresh_;
  base::WeakPtrFactory<AdBlocking> weak_factory_{this};
};

// Puts AdBlocking in front of `frame`'s network loads: a request a website's
// page makes, in a profile that blocks ads, fails with
// ERR_BLOCKED_BY_CLIENT when the blocker says so, and any other goes to the
// network as before. Not for a worker's loads (no frame), an Electron app's
// pages, or the shell's and extensions' own pages. Called from
// ChromeContentBrowserClient::WillCreateURLLoaderFactory.
void ProxyAdBlocking(content::RenderFrameHost* frame,
                     network::URLLoaderFactoryBuilder& builder);

// Hides what the lists name by its elements in each website page `guest`
// commits, in its mode (Standard and Strict alike; Off hides nothing): sends
// the page's frame its cosmetic filters before it commits, for
// CosmeticFilters in the renderer. Not an Electron app's pages. From
// AttachTabHelpers.
void AttachCosmeticFiltering(content::WebContents& guest);

}  // namespace domicile

#endif  // CHROME_BROWSER_DOMICILE_DOMICILE_AD_BLOCKING_H_
