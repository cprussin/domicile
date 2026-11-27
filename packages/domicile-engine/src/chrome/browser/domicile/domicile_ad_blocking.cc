// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_ad_blocking.h"

#include <algorithm>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/files/file_util.h"
#include "base/files/important_file_writer.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/self_deleting.h"
#include "base/memory/weak_ptr.h"
#include "base/path_service.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/domicile/domicile_electron_page.h"
#include "chrome/browser/net/system_network_context_manager.h"
#include "chrome/common/chrome_paths.h"
#include "components/domicile/ad_blocking/ad_blocker.h"
#include "components/domicile/browser/browser_profiles.h"
#include "components/domicile/browser/page_privacy.h"
#include "components/domicile/browser/site_privacy.h"
#include "components/domicile/mojom/cosmetic_filters.mojom.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/global_routing_id.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "crypto/hash.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "mojo/public/cpp/bindings/pending_associated_remote.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "mojo/public/cpp/bindings/self_owned_associated_receiver.h"
#include "net/base/net_errors.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/self_deleting_url_loader_factory.h"
#include "services/network/public/cpp/shared_url_loader_factory.h"
#include "services/network/public/cpp/simple_url_loader.h"
#include "services/network/public/cpp/url_loader_completion_status.h"
#include "services/network/public/cpp/url_loader_factory_builder.h"
#include "services/network/public/mojom/url_loader.mojom.h"
#include "services/network/public/mojom/url_loader_factory.mojom.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_provider.h"
#include "url/gurl.h"

namespace domicile {

namespace {

constexpr net::NetworkTrafficAnnotationTag kTrafficAnnotation =
    net::DefineNetworkTrafficAnnotation("domicile_block_lists", R"(
      semantics {
        sender: "Domicile ad blocking"
        description:
          "Fetches a filter list that the desktop's config names, such as "
          "EasyList, to block ads and trackers with, or the scriptlets its "
          "rules run."
        trigger:
          "The desktop starts, or the config names a list, with no copy kept "
          "or one kept for a day or more."
        data: "None. The request carries no cookies."
        destination: OTHER
      }
      policy {
        cookies_allowed: NO
        setting:
          "Set `browser.block_lists` in the desktop's config to the lists to "
          "use, or to [], and `browser.scriptlet_resources` to null."
        policy_exception_justification: "Not a Chrome feature."
      })");

// How long a fetched list is kept before it is fetched again, and how often
// that is checked.
constexpr base::TimeDelta kKeepFor = base::Days(1);
constexpr base::TimeDelta kCheckEvery = base::Hours(1);
// The most `DownloadToString` takes (5 MB): it CHECKs the bound. EasyList,
// EasyPrivacy and uBlock Origin's filters are each 1 to 2 MB. A larger list
// fails its fetch, which `Fetched` logs.
constexpr size_t kMaxListSize =
    network::SimpleURLLoader::kMaxBoundedStringDownloadSize;
constexpr base::TimeDelta kFetchTimeout = base::Minutes(2);

bool IsFetched(const std::string& list) {
  return base::StartsWith(list, "https://");
}

// Where a fetched list is kept, by the hash of its address.
base::FilePath KeptAt(const base::FilePath& dir, const std::string& list) {
  return dir.AppendASCII(
      base::ToLowerASCII(base::HexEncode(crypto::hash::Sha256(list))) +
      ".txt");
}

// A list's text, if it is one the engine can read.
std::optional<std::string> Checked(const std::string& list,
                                   std::optional<std::string> text) {
  if (!text.has_value()) {
    return std::nullopt;
  }
  if (!base::IsStringUTF8(*text)) {
    LOG(ERROR) << "domicile: block list " << list
               << " is not UTF-8 text, so it is left out.";
    return std::nullopt;
  }
  return text;
}

// Whether `text` is the file `pin`, a SHA-256 in lowercase hex, names: any
// is without one.
bool MatchesPin(const std::string& text,
                const std::optional<std::string>& pin) {
  return !pin.has_value() ||
         base::ToLowerASCII(base::HexEncode(crypto::hash::Sha256(text))) ==
             *pin;
}

constexpr char kPinned[] = "#sha256=";

}  // namespace

AdBlocking::Read::Read() = default;
AdBlocking::Read::Read(Read&&) = default;
AdBlocking::Read& AdBlocking::Read::operator=(Read&&) = default;
AdBlocking::Read::~Read() = default;

// static
AdBlocking& AdBlocking::Get() {
  static base::NoDestructor<AdBlocking> ad_blocking;
  return *ad_blocking;
}

AdBlocking::AdBlocking() {
  base::FilePath user_data;
  CHECK(base::PathService::Get(chrome::DIR_USER_DATA, &user_data));
  kept_dir_ = user_data.AppendASCII("domicile-block-lists");
}

AdBlocking::~AdBlocking() = default;

void AdBlocking::Configure(std::vector<std::string> lists,
                           std::vector<std::string> rules,
                           std::vector<std::string> cookie_banner_lists,
                           std::optional<std::string> scriptlet_resources) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  // The config checked the pin is a whole SHA-256.
  std::optional<std::string> scriptlets;
  std::optional<std::string> pin;
  if (scriptlet_resources.has_value()) {
    const size_t at = scriptlet_resources->find(kPinned);
    scriptlets = scriptlet_resources->substr(0, at);
    if (at != std::string::npos) {
      pin = base::ToLowerASCII(
          scriptlet_resources->substr(at + std::size(kPinned) - 1));
    }
  }
  if (configured_ && lists == lists_ && rules == rules_ &&
      cookie_banner_lists == cookie_banner_lists_ &&
      scriptlets == scriptlets_ && pin == scriptlets_pin_) {
    return;
  }
  configured_ = true;
  lists_ = std::move(lists);
  rules_ = std::move(rules);
  cookie_banner_lists_ = std::move(cookie_banner_lists);
  scriptlets_ = std::move(scriptlets);
  scriptlets_pin_ = std::move(pin);
  ++generation_;
  // A build under way is for the old config.
  ++build_;
  ready_ = false;
  VLOG(1) << "domicile: ad blocking: reading " << lists_.size()
          << " block lists and " << cookie_banner_lists_.size()
          << " cookie banner lists, with " << rules_.size()
          << " rules of the user's and "
          << (scriptlets_.has_value() ? "the scriptlets at " + *scriptlets_
                                      : std::string("no scriptlets"))
          << (scriptlets_pin_.has_value() ? " (pinned)" : "");
  // Paths are read again; fetched lists come from where they were kept.
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::MayBlock(), base::TaskPriority::USER_BLOCKING},
      base::BindOnce(
          [](base::FilePath dir, std::vector<std::string> lists,
             std::optional<std::string> scriptlets,
             std::optional<std::string> pin) {
            Read read;
            for (const std::string& list : lists) {
              std::string text;
              if (IsFetched(list)) {
                const base::FilePath kept = KeptAt(dir, list);
                base::File::Info info;
                if (!base::GetFileInfo(kept, &info) ||
                    !base::ReadFileToString(kept, &text)) {
                  VLOG(1) << "domicile: ad blocking: no copy of " << list
                          << " is kept yet";
                  continue;
                }
                read.kept[list] = info.last_modified;
              } else if (!base::ReadFileToString(base::FilePath(list),
                                                 &text)) {
                LOG(ERROR) << "domicile: block list " << list
                           << " cannot be read, so it is left out.";
                continue;
              }
              if (list == scriptlets && !MatchesPin(text, pin)) {
                // A kept copy is the one fetched, which was checked: this
                // is a pin the config changed, or a copy changed since.
                LOG(ERROR) << "domicile: the scriptlets kept for " << list
                           << " are not the file the config's #sha256= "
                              "names, so they are fetched again.";
                read.kept.erase(list);
                continue;
              }
              if (std::optional<std::string> checked =
                      Checked(list, std::move(text))) {
                read.texts[list] = *std::move(checked);
              }
            }
            return read;
          },
          kept_dir_, AllLists(), scriptlets_, scriptlets_pin_),
      base::BindOnce(&AdBlocking::Started, weak_factory_.GetWeakPtr(),
                     generation_));
  if (!refresh_.IsRunning()) {
    refresh_.Start(FROM_HERE, kCheckEvery,
                   base::BindRepeating(&AdBlocking::FetchStale,
                                       base::Unretained(this)));
  }
}

void AdBlocking::WhenReady(base::OnceClosure ready) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (ready_) {
    std::move(ready).Run();
    return;
  }
  waiting_.push_back(std::move(ready));
}

std::vector<std::string> AdBlocking::AllLists() const {
  std::vector<std::string> all = lists_;
  all.insert(all.end(), cookie_banner_lists_.begin(),
             cookie_banner_lists_.end());
  if (scriptlets_.has_value()) {
    all.push_back(*scriptlets_);
  }
  return all;
}

bool AdBlocking::Names(const std::string& list) const {
  // Not `base::Contains`: `base/containers/contains.h` is gone at our pin.
  return std::ranges::find(lists_, list) != lists_.end() ||
         std::ranges::find(cookie_banner_lists_, list) !=
             cookie_banner_lists_.end() ||
         list == scriptlets_;
}

std::vector<std::string> AdBlocking::TextsOf(
    const std::vector<std::string>& lists) const {
  std::vector<std::string> texts;
  for (const std::string& list : lists) {
    if (auto found = texts_.find(list); found != texts_.end()) {
      texts.push_back(found->second);
    }
  }
  return texts;
}

void AdBlocking::Started(int generation, Read read) {
  if (generation != generation_) {
    return;
  }
  texts_ = std::move(read.texts);
  kept_ = std::move(read.kept);
  Rebuild();
  FetchStale();
}

void AdBlocking::Rebuild() {
  const int build = ++build_;
  std::vector<std::string> texts = TextsOf(lists_);
  std::vector<std::string> cookie_texts = TextsOf(cookie_banner_lists_);
  std::optional<std::string> scriptlets_text;
  if (scriptlets_.has_value()) {
    if (auto found = texts_.find(*scriptlets_); found != texts_.end()) {
      scriptlets_text = found->second;
    }
  }
  VLOG(1) << "domicile: ad blocking: building from " << texts.size() << " of "
          << lists_.size() << " block lists, " << cookie_texts.size() << " of "
          << cookie_banner_lists_.size() << " cookie banner lists and "
          << rules_.size() << " rules of the user's, "
          << (scriptlets_text.has_value() ? "with" : "without")
          << " scriptlets";
  if (texts.empty() && cookie_texts.empty() && rules_.empty()) {
    Built(build, nullptr);
    return;
  }
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::TaskPriority::USER_BLOCKING},
      base::BindOnce(
          [](std::vector<std::string> texts, std::vector<std::string> rules,
             std::vector<std::string> cookie_texts,
             std::optional<std::string> scriptlets_at,
             std::optional<std::string> scriptlets_text) {
            const base::TimeTicks start = base::TimeTicks::Now();
            std::vector<AdBlocker::Scriptlet> scriptlets;
            if (scriptlets_text.has_value()) {
              std::optional<std::vector<AdBlocker::Scriptlet>> read =
                  AdBlocker::ScriptletsIn(*scriptlets_text);
              if (read.has_value()) {
                scriptlets = *std::move(read);
              } else {
                LOG(ERROR) << "domicile: the scriptlets at " << *scriptlets_at
                           << " are not an adblock-rust resources file, so "
                              "no ##+js(...) rule runs.";
              }
            }
            std::unique_ptr<AdBlocker> blocker =
                AdBlocker::Build(texts, rules, cookie_texts, scriptlets);
            VLOG(1) << "domicile: ad blocking: built with " << scriptlets.size()
                    << " scriptlets in " << (base::TimeTicks::Now() - start);
            return blocker;
          },
          std::move(texts), rules_, std::move(cookie_texts), scriptlets_,
          std::move(scriptlets_text)),
      base::BindOnce(&AdBlocking::Built, weak_factory_.GetWeakPtr(), build));
}

void AdBlocking::Built(int build, std::unique_ptr<AdBlocker> blocker) {
  if (build != build_) {
    return;
  }
  blocker_ = std::move(blocker);
  VLOG(1) << "domicile: ad blocking: "
          << (blocker_ ? "blocking" : "nothing to block with") << "; "
          << waiting_.size() << " requests waited for it";
  ready_ = true;
  std::vector<base::OnceClosure> waiting = std::move(waiting_);
  for (base::OnceClosure& ready : waiting) {
    std::move(ready).Run();
  }
}

void AdBlocking::FetchStale() {
  const base::Time now = base::Time::Now();
  for (const std::string& list : AllLists()) {
    if (!IsFetched(list) || fetching_.contains(list)) {
      continue;
    }
    if (auto kept = kept_.find(list);
        kept != kept_.end() &&
        (now - kept->second < kKeepFor ||
         // A pinned file can't change: the one kept is the one to use.
         (list == scriptlets_ && scriptlets_pin_.has_value()))) {
      continue;
    }
    VLOG(1) << "domicile: ad blocking: fetching " << list;
    fetching_.insert(list);
    auto request = std::make_unique<network::ResourceRequest>();
    request->url = GURL(list);
    request->credentials_mode = network::mojom::CredentialsMode::kOmit;
    std::unique_ptr<network::SimpleURLLoader> loader =
        network::SimpleURLLoader::Create(std::move(request),
                                         kTrafficAnnotation);
    loader->SetTimeoutDuration(kFetchTimeout);
    loader->SetRetryOptions(
        2, network::SimpleURLLoader::RETRY_ON_NETWORK_CHANGE |
               network::SimpleURLLoader::RETRY_ON_5XX);
    network::SimpleURLLoader* raw = loader.get();
    raw->DownloadToString(
        g_browser_process->system_network_context_manager()
            ->GetSharedURLLoaderFactory()
            .get(),
        base::BindOnce(&AdBlocking::Fetched, weak_factory_.GetWeakPtr(), list,
                       std::move(loader)),
        kMaxListSize);
  }
}

void AdBlocking::Fetched(const std::string& list,
                         std::unique_ptr<network::SimpleURLLoader> loader,
                         std::optional<std::string> body) {
  fetching_.erase(list);
  if (!body.has_value() || body->empty()) {
    // Tried again at the next check; the kept copy, if any, stays in use.
    LOG(WARNING) << "domicile: block list " << list << " could not be fetched ("
                 << net::ErrorToShortString(loader->NetError())
                 << "); trying again within " << kCheckEvery;
    return;
  }
  if (list == scriptlets_ && !MatchesPin(*body, scriptlets_pin_)) {
    // Not kept: the kept copy, if any, stays in use, and this is fetched
    // again at the next check.
    LOG(ERROR) << "domicile: the scriptlets fetched from " << list
               << " are not the file the config's #sha256= names ("
               << *scriptlets_pin_ << "), so they are left out; trying again "
               << "within " << kCheckEvery;
    return;
  }
  std::optional<std::string> text = Checked(list, std::move(body));
  if (!text.has_value() || !Names(list)) {
    return;
  }
  VLOG(1) << "domicile: ad blocking: fetched " << list << ", "
          << text->size() << " bytes";
  kept_[list] = base::Time::Now();
  base::ThreadPool::PostTask(
      FROM_HERE, {base::MayBlock(), base::TaskPriority::BEST_EFFORT},
      base::BindOnce(
          [](base::FilePath dir, base::FilePath at, std::string text) {
            if (!base::CreateDirectory(dir) ||
                !base::ImportantFileWriter::WriteFileAtomically(at, text)) {
              LOG(ERROR) << "domicile: ad blocking could not keep a block "
                            "list at "
                         << at << "; it is fetched again at the next start.";
            }
          },
          kept_dir_, KeptAt(kept_dir_, list), *text));
  texts_[list] = *std::move(text);
  Rebuild();
}

namespace {

// Checks each request of one frame's page against AdBlocking. See
// ProxyAdBlocking.
class AdBlockingURLLoaderFactory final
    : public network::SelfDeletingURLLoaderFactory {
 public:
  AdBlockingURLLoaderFactory(
      mojo::PendingReceiver<network::mojom::URLLoaderFactory> receiver,
      mojo::PendingRemote<network::mojom::URLLoaderFactory> network,
      content::GlobalRenderFrameHostId frame,
      base::SelfDeletingPassKey key)
      : network::SelfDeletingURLLoaderFactory(std::move(receiver), key),
        network_(std::move(network)),
        frame_(frame) {}

  // network::mojom::URLLoaderFactory:
  void CreateLoaderAndStart(
      mojo::PendingReceiver<network::mojom::URLLoader> loader,
      int32_t request_id,
      uint32_t options,
      const network::ResourceRequest& request,
      mojo::PendingRemote<network::mojom::URLLoaderClient> client,
      const net::MutableNetworkTrafficAnnotationTag& traffic_annotation)
      override {
    AdBlocking::Get().WhenReady(base::BindOnce(
        &AdBlockingURLLoaderFactory::Start, weak_factory_.GetWeakPtr(),
        std::move(loader), request_id, options, request, std::move(client),
        traffic_annotation));
  }

 private:
  ~AdBlockingURLLoaderFactory() override = default;

  void Start(mojo::PendingReceiver<network::mojom::URLLoader> loader,
             int32_t request_id,
             uint32_t options,
             const network::ResourceRequest& request,
             mojo::PendingRemote<network::mojom::URLLoaderClient> client,
             const net::MutableNetworkTrafficAnnotationTag& traffic_annotation) {
    if (Blocks(request)) {
      mojo::Remote<network::mojom::URLLoaderClient>(std::move(client))
          ->OnComplete(
              network::URLLoaderCompletionStatus(net::ERR_BLOCKED_BY_CLIENT));
      return;
    }
    network_->CreateLoaderAndStart(std::move(loader), request_id, options,
                                   request, std::move(client),
                                   traffic_annotation);
  }

  // Whether the blocker blocks `request`, in its page's mode, and counts it
  // for the page if so.
  bool Blocks(const network::ResourceRequest& request) const {
    const AdBlocker* blocker = AdBlocking::Get().blocker();
    // A page's own navigation is the user's to make.
    if (blocker == nullptr ||
        request.destination == network::mojom::RequestDestination::kDocument ||
        !(request.url.SchemeIsHTTPOrHTTPS() || request.url.SchemeIsWSOrWSS())) {
      return false;
    }
    content::RenderFrameHost* frame = content::RenderFrameHost::FromID(frame_);
    if (frame == nullptr) {
      return false;
    }
    content::WebContents* contents =
        content::WebContents::FromRenderFrameHost(frame);
    // An app may take a window over after its frame's loader was made.
    if (ElectronPage::SessionOf(*contents)) {
      return false;
    }
    // The page is the guest's own top document: a <webview>'s embedder is
    // the shell, not the site.
    const GURL& page = contents->GetPrimaryMainFrame()->GetLastCommittedURL();
    if (!page.SchemeIsHTTPOrHTTPS()) {
      return false;
    }
    // The page's own: its window's, its site's or its profile's.
    PagePrivacy::CreateForWebContents(contents);
    PagePrivacy& privacy = *PagePrivacy::FromWebContents(contents);
    const AdBlockingMode mode = privacy.mode();
    if (mode == AdBlockingMode::kOff) {
      return false;
    }
    const bool strict = mode == AdBlockingMode::kStrict;
    const bool cookie_banners =
        privacy.IsOn(PageProtection::kHideCookieBanners);
    const std::string_view type = AdBlockRequestType(request.destination);
    if (!blocker->ShouldBlock(request.url, page, type, request.method, strict,
                              cookie_banners)) {
      return false;
    }
    privacy.CountBlocked();
    VLOG(1) << "domicile: ad blocking: blocked a " << type << " request for "
            << request.url.possibly_invalid_spec() << " from "
            << page.possibly_invalid_spec() << " (" << AdBlockingModeName(mode)
            << (cookie_banners ? ", cookie banners hidden" : "") << ")";
    return true;
  }

  mojo::Remote<network::mojom::URLLoaderFactory> network_;
  const content::GlobalRenderFrameHostId frame_;
  base::WeakPtrFactory<AdBlockingURLLoaderFactory> weak_factory_{this};
};

// Answers one document's CosmeticFilters about its classes and ids, with the
// generic rules its site's exceptions leave. Owned by its receiver, so it
// goes with the document.
class CosmeticFiltersHost final : public mojom::CosmeticFiltersHost {
 public:
  CosmeticFiltersHost(std::vector<std::string> exceptions,
                      bool hide_cookie_banners)
      : exceptions_(std::move(exceptions)),
        hide_cookie_banners_(hide_cookie_banners) {}

  // mojom::CosmeticFiltersHost:
  void HiddenSelectors(const std::vector<std::string>& classes,
                       const std::vector<std::string>& ids,
                       HiddenSelectorsCallback answer) override {
    // The blocker of the moment: a fetch may have rebuilt it since the page
    // committed.
    const AdBlocker* blocker = AdBlocking::Get().blocker();
    if (blocker == nullptr) {
      std::move(answer).Run({});
      return;
    }
    std::move(answer).Run(blocker->HiddenClassIdSelectors(
        classes, ids, exceptions_, hide_cookie_banners_));
  }

 private:
  const std::vector<std::string> exceptions_;
  // As the page was when it committed, as its other filters are.
  const bool hide_cookie_banners_;
};

// Sends each website frame of one guest its cosmetic filters before it
// commits. See AttachCosmeticFiltering.
class CosmeticFiltering final
    : public content::WebContentsObserver,
      public content::WebContentsUserData<CosmeticFiltering> {
 public:
  CosmeticFiltering(const CosmeticFiltering&) = delete;
  CosmeticFiltering& operator=(const CosmeticFiltering&) = delete;
  ~CosmeticFiltering() override = default;

  // content::WebContentsObserver:
  void ReadyToCommitNavigation(content::NavigationHandle* navigation) override {
    if (navigation->IsSameDocument() || navigation->IsErrorPage()) {
      return;
    }
    // A prerendered or fenced page is not the window's yet; it is hidden
    // when the window navigates to it.
    if (navigation->IsInMainFrame() && !navigation->IsInPrimaryMainFrame()) {
      return;
    }
    const GURL& url = navigation->GetURL();
    if (!url.SchemeIsHTTPOrHTTPS()) {
      return;
    }
    // An app may take a window over after it was attached.
    if (ElectronPage::SessionOf(GetWebContents())) {
      return;
    }
    const AdBlocker* blocker = AdBlocking::Get().blocker();
    if (blocker == nullptr) {
      return;
    }
    // The page's mode: for its main frame, the page about to commit's; for
    // a frame in it, the committed page's.
    PagePrivacy::CreateForWebContents(&GetWebContents());
    const PagePrivacy& privacy =
        *PagePrivacy::FromWebContents(&GetWebContents());
    const AdBlockingMode mode = navigation->IsInPrimaryMainFrame()
                                    ? privacy.ModeFor(url)
                                    : privacy.mode();
    if (mode == AdBlockingMode::kOff) {
      return;
    }
    const bool cookie_banners =
        navigation->IsInPrimaryMainFrame()
            ? privacy.IsOnFor(PageProtection::kHideCookieBanners, url)
            : privacy.IsOn(PageProtection::kHideCookieBanners);
    AdBlocker::Cosmetics cosmetics = blocker->CosmeticsFor(url, cookie_banners);
    mojo::PendingAssociatedRemote<mojom::CosmeticFiltersHost> host;
    if (!cosmetics.generichide) {
      mojo::MakeSelfOwnedAssociatedReceiver(
          std::make_unique<CosmeticFiltersHost>(std::move(cosmetics.exceptions),
                                                cookie_banners),
          host.InitWithNewEndpointAndPassReceiver());
    }
    VLOG(1) << "domicile: ad blocking: hiding "
            << cosmetics.hide_selectors.size() << " selectors"
            << (cosmetics.generichide ? ", and no generic ones," : "")
            << (cosmetics.script.empty() ? "" : ", running scriptlets,")
            << " in " << url.possibly_invalid_spec() << " ("
            << AdBlockingModeName(mode)
            << (cookie_banners ? ", cookie banners hidden" : "") << ")";
    mojo::AssociatedRemote<mojom::CosmeticFilters> frame;
    navigation->GetRenderFrameHost()
        ->GetRemoteAssociatedInterfaces()
        ->GetInterface(&frame);
    frame->Hide(std::move(cosmetics.hide_selectors),
                std::move(cosmetics.script), std::move(host));
  }

 private:
  friend class content::WebContentsUserData<CosmeticFiltering>;
  explicit CosmeticFiltering(content::WebContents* contents)
      : content::WebContentsObserver(contents),
        content::WebContentsUserData<CosmeticFiltering>(*contents) {}

  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(CosmeticFiltering);

}  // namespace

void ProxyAdBlocking(content::RenderFrameHost* frame,
                     network::URLLoaderFactoryBuilder& builder) {
  // A worker's loads have no frame, and are not checked yet.
  if (frame == nullptr) {
    return;
  }
  content::WebContents* contents =
      content::WebContents::FromRenderFrameHost(frame);
  // An Electron app's pages are the app's, as in Electron.
  if (contents == nullptr || ElectronPage::SessionOf(*contents)) {
    return;
  }
  // Every load of the frame, whatever its page is now: it may navigate to a
  // website, and the profile's mode may change.
  auto [receiver, network] = builder.Append();
  base::MakeSelfDeleting<AdBlockingURLLoaderFactory>(
      std::move(receiver), std::move(network), frame->GetGlobalId());
}

void AttachCosmeticFiltering(content::WebContents& guest) {
  CosmeticFiltering::CreateForWebContents(&guest);
}

}  // namespace domicile
