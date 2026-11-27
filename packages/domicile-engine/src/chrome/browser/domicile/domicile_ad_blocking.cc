// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "chrome/browser/domicile/domicile_ad_blocking.h"

#include <algorithm>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/byte_size.h"
#include "base/files/file_util.h"
#include "base/files/important_file_writer.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/self_deleting.h"
#include "base/memory/weak_ptr.h"
#include "base/path_service.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/stringprintf.h"
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
#include "content/public/browser/storage_partition.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "crypto/hash.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "mojo/public/cpp/bindings/pending_associated_remote.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "mojo/public/cpp/bindings/self_owned_associated_receiver.h"
#include "mojo/public/cpp/system/data_pipe.h"
#include "net/base/address_list.h"
#include "net/base/data_url.h"
#include "net/base/host_port_pair.h"
#include "net/base/net_errors.h"
#include "net/base/network_anonymization_key.h"
#include "net/base/registry_controlled_domains/registry_controlled_domain.h"
#include "net/dns/public/dns_query_type.h"
#include "net/http/http_response_headers.h"
#include "net/http/http_status_code.h"
#include "net/http/http_util.h"
#include "net/proxy_resolution/proxy_info.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "net/url_request/redirect_info.h"
#include "services/network/public/cpp/parsed_headers.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/self_deleting_url_loader_factory.h"
#include "services/network/public/cpp/shared_url_loader_factory.h"
#include "services/network/public/cpp/simple_host_resolver.h"
#include "services/network/public/cpp/simple_url_loader.h"
#include "services/network/public/cpp/url_loader_completion_status.h"
#include "services/network/public/cpp/url_loader_factory_builder.h"
#include "services/network/public/mojom/early_hints.mojom.h"
#include "services/network/public/mojom/fetch_api.mojom.h"
#include "services/network/public/mojom/host_resolver.mojom.h"
#include "services/network/public/mojom/network_context.mojom.h"
#include "services/network/public/mojom/proxy_lookup_client.mojom.h"
#include "services/network/public/mojom/url_loader.mojom.h"
#include "services/network/public/mojom/url_loader_factory.mojom.h"
#include "services/network/public/mojom/url_response_head.mojom.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_provider.h"
#include "url/gurl.h"
#include "url/origin.h"

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

// How long a fetched list is kept before it is fetched again, when its
// `! Expires:` says nothing, and how often that is checked.
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
  keep_for_.clear();
  for (const auto& [list, text] : texts_) {
    KeepFor(list, text);
  }
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

void AdBlocking::KeepFor(const std::string& list, const std::string& text) {
  if (!IsFetched(list)) {
    return;
  }
  const std::optional<base::TimeDelta> expiry = AdBlocker::ListExpiry(text);
  keep_for_[list] = expiry.value_or(kKeepFor);
  VLOG(1) << "domicile: ad blocking: " << list << " is fetched again after "
          << keep_for_[list] << (expiry ? ", as its ! Expires: says" : "");
}

void AdBlocking::FetchStale() {
  const base::Time now = base::Time::Now();
  for (const std::string& list : AllLists()) {
    if (!IsFetched(list) || fetching_.contains(list)) {
      continue;
    }
    if (auto kept = kept_.find(list);
        kept != kept_.end() &&
        (now - kept->second <
             (keep_for_.contains(list) ? keep_for_.at(list) : kKeepFor) ||
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
  KeepFor(list, *text);
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

// The page a request is checked for, and that page's mode.
struct CheckedIn {
  GURL page;
  AdBlockingMode mode;
  // Whether the page hides cookie banners, so the cookie banner lists'
  // rules apply too.
  bool cookie_banners = false;
};

// What `request`, from the frame `frame_id`, is checked in: nothing when it
// is not checked, as when no blocker is up, the page is not a website's or
// its mode is Off. A frame tree's own navigation (kDocument) is checked in
// the mode of the page it goes to; any other request in the committed
// page's.
std::optional<CheckedIn> CheckedInFor(content::GlobalRenderFrameHostId frame_id,
                                      const network::ResourceRequest& request) {
  if (AdBlocking::Get().blocker() == nullptr ||
      !(request.url.SchemeIsHTTPOrHTTPS() || request.url.SchemeIsWSOrWSS())) {
    return std::nullopt;
  }
  content::RenderFrameHost* frame = content::RenderFrameHost::FromID(frame_id);
  if (frame == nullptr) {
    return std::nullopt;
  }
  content::WebContents* contents =
      content::WebContents::FromRenderFrameHost(frame);
  const bool navigation =
      request.destination == network::mojom::RequestDestination::kDocument;
  // The page is the guest's own top document: a <webview>'s embedder is the
  // shell, not the site.
  const GURL page =
      navigation ? request.url
                 : contents->GetPrimaryMainFrame()->GetLastCommittedURL();
  // Checked when its loader starts, as an app may take a window over later.
  if (ElectronPage::SessionOf(*contents)) {
    // An app's page is in no profile, so has no mode of its own.
    return AdBlocking::Get().blocks_electron_apps() &&
                   page.SchemeIsHTTPOrHTTPS()
               ? std::optional<CheckedIn>(
                     {.page = page, .mode = AdBlockingMode::kStandard})
               : std::nullopt;
  }
  PagePrivacy::CreateForWebContents(contents);
  const PagePrivacy& privacy = *PagePrivacy::FromWebContents(contents);
  CheckedIn checked = {
      .page = page,
      .mode = navigation ? privacy.ModeFor(page) : privacy.mode(),
      .cookie_banners =
          navigation ? privacy.IsOnFor(PageProtection::kHideCookieBanners, page)
                     : privacy.IsOn(PageProtection::kHideCookieBanners)};
  if (!checked.page.SchemeIsHTTPOrHTTPS() ||
      checked.mode == AdBlockingMode::kOff) {
    return std::nullopt;
  }
  return checked;
}

bool IsDocument(const network::ResourceRequest& request) {
  using network::mojom::RequestDestination;
  return request.destination == RequestDestination::kDocument ||
         request.destination == RequestDestination::kIframe ||
         request.destination == RequestDestination::kFrame ||
         request.destination == RequestDestination::kFencedframe;
}

// One checked request, between the page's loader and the network's: blocks
// it, answers a `$redirect` with its stand-in, loads it without what
// `$removeparam` removes, checks it again under its host's canonical name,
// checks each redirect the network answers, and adds a document's `$csp`.
// See ProxyAdBlocking.
class AdBlockingLoader final : public network::mojom::URLLoader,
                               public network::mojom::URLLoaderClient,
                               public network::mojom::ProxyLookupClient {
 public:
  AdBlockingLoader(
      CheckedIn checked,
      content::GlobalRenderFrameHostId frame,
      mojo::PendingRemote<network::mojom::URLLoaderFactory> network,
      int32_t request_id,
      uint32_t options,
      const network::ResourceRequest& request,
      mojo::PendingReceiver<network::mojom::URLLoader> loader,
      mojo::PendingRemote<network::mojom::URLLoaderClient> client,
      const net::MutableNetworkTrafficAnnotationTag& traffic_annotation)
      : checked_(std::move(checked)),
        frame_(frame),
        network_(std::move(network)),
        request_id_(request_id),
        options_(options),
        request_(request),
        traffic_annotation_(traffic_annotation),
        loader_(this, std::move(loader)),
        client_(std::move(client)) {
    loader_.set_disconnect_handler(
        base::BindOnce(&AdBlockingLoader::Done, base::Unretained(this)));
    client_.set_disconnect_handler(
        base::BindOnce(&AdBlockingLoader::Done, base::Unretained(this)));
  }

  void Start() {
    const AdBlocker::Decision decision = Decide(request_);
    switch (decision.kind) {
      case AdBlocker::Decision::Kind::kBlock:
        return Fail(net::ERR_BLOCKED_BY_CLIENT);
      case AdBlocker::Decision::Kind::kRedirect:
        return Stub(decision.url);
      case AdBlocker::Decision::Kind::kRewrite:
        return RedirectTo(decision.url);
      case AdBlocker::Decision::Kind::kAllow:
        return Uncloak();
    }
  }

  // network::mojom::ProxyLookupClient:
  void OnProxyLookupComplete(
      int32_t net_error,
      const std::optional<net::ProxyInfo>& proxy_info) override {
    proxy_lookup_.reset();
    // Through a proxy, the name this host resolves to here is not the one
    // the request reaches, and a lookup would tell the DNS server what the
    // proxy is meant to hide. Brave skips these too.
    if (net_error != net::OK || !proxy_info || !proxy_info->is_direct()) {
      return StartOnTheNetwork();
    }
    content::RenderFrameHost* frame = content::RenderFrameHost::FromID(frame_);
    if (frame == nullptr) {
      return StartOnTheNetwork();
    }
    resolver_ = network::SimpleHostResolver::Create(
        frame->GetStoragePartition()->GetNetworkContext());
    auto parameters = network::mojom::ResolveHostParameters::New();
    parameters->include_canonical_name = true;
    parameters->dns_query_type = net::DnsQueryType::A;
    resolver_->ResolveHost(
        network::mojom::HostResolverHost::NewHostPortPair(
            net::HostPortPair::FromURL(request_.url)),
        anonymization_key_, std::move(parameters),
        base::BindOnce(&AdBlockingLoader::Resolved, base::Unretained(this)));
  }

  // network::mojom::URLLoader:
  void FollowRedirect(network::HttpRequestHeadersUpdateParams update,
                      const std::optional<GURL>& new_url) override {
    if (rewritten_) {
      // RedirectTo's own: the network has not seen the request yet.
      request_.url = *std::exchange(rewritten_, std::nullopt);
      for (const std::string& name : update.removed_headers) {
        request_.headers.RemoveHeader(name);
      }
      request_.headers.MergeFrom(update.modified_headers);
      request_.cors_exempt_headers.MergeFrom(
          update.modified_cors_exempt_headers);
      return StartOnTheNetwork();
    }
    // Any other redirect is the network's, so its loader is up.
    CHECK(network_loader_);
    network_loader_->FollowRedirect(std::move(update), new_url);
  }

  void SetPriority(net::RequestPriority priority,
                   int32_t intra_priority_value) override {
    request_.priority = priority;
    if (network_loader_) {
      network_loader_->SetPriority(priority, intra_priority_value);
    }
  }

  // network::mojom::URLLoaderClient:
  void OnReceiveEarlyHints(network::mojom::EarlyHintsPtr hints) override {
    client_->OnReceiveEarlyHints(std::move(hints));
  }

  void OnReceiveResponse(
      network::mojom::URLResponseHeadPtr head,
      mojo::ScopedDataPipeConsumerHandle body,
      std::optional<mojo_base::BigBuffer> cached_metadata) override {
    const AdBlocker* blocker = AdBlocking::Get().blocker();
    if (blocker != nullptr && IsDocument(request_) && head->headers) {
      const std::string directives =
          blocker->CspDirectives(request_.url, PageOf(request_),
                                 AdBlockRequestType(request_.destination),
                                 request_.method, checked_.cookie_banners);
      if (!directives.empty()) {
        VLOG(1) << "domicile: ad blocking: adding the policy " << directives
                << " to " << request_.url.possibly_invalid_spec();
        head->headers->AddHeader("Content-Security-Policy", directives);
        // Blink reads a document's policy from the parsed headers.
        head->parsed_headers =
            network::PopulateParsedHeaders(head->headers.get(), request_.url);
      }
    }
    client_->OnReceiveResponse(std::move(head), std::move(body),
                               std::move(cached_metadata));
  }

  void OnReceiveRedirect(const net::RedirectInfo& redirect,
                         network::mojom::URLResponseHeadPtr head) override {
    network::ResourceRequest next = request_;
    next.url = redirect.new_url;
    next.method = redirect.new_method;
    // A server's redirect is followed as it is: rewriting it again could
    // loop with a server that adds the parameters back.
    if (Decide(next).blocks()) {
      return Fail(net::ERR_BLOCKED_BY_CLIENT);
    }
    request_ = std::move(next);
    client_->OnReceiveRedirect(redirect, std::move(head));
  }

  void OnUploadProgress(int64_t current_position,
                        int64_t total_size,
                        OnUploadProgressCallback callback) override {
    client_->OnUploadProgress(current_position, total_size,
                              std::move(callback));
  }

  void OnTransferSizeUpdated(int32_t transfer_size_diff) override {
    client_->OnTransferSizeUpdated(transfer_size_diff);
  }

  void OnComplete(const network::URLLoaderCompletionStatus& status) override {
    client_->OnComplete(status);
    Done();
  }

 private:
  ~AdBlockingLoader() override = default;

  // The page `request` is checked for: itself, when it is a frame tree's
  // navigation.
  GURL PageOf(const network::ResourceRequest& request) const {
    return request.destination == network::mojom::RequestDestination::kDocument
               ? request.url
               : checked_.page;
  }

  AdBlocker::Decision Decide(const network::ResourceRequest& request) const {
    const AdBlocker* blocker = AdBlocking::Get().blocker();
    // A page's own navigation is the user's to make.
    if (blocker == nullptr ||
        request.destination == network::mojom::RequestDestination::kDocument ||
        !(request.url.SchemeIsHTTPOrHTTPS() || request.url.SchemeIsWSOrWSS())) {
      return {};
    }
    const std::string_view type = AdBlockRequestType(request.destination);
    AdBlocker::Decision decision = blocker->Decide(
        request.url, checked_.page, type, request.method,
        checked_.mode == AdBlockingMode::kStrict, checked_.cookie_banners);
    if (decision.kind != AdBlocker::Decision::Kind::kAllow) {
      VLOG(1) << "domicile: ad blocking: "
              << (decision.kind == AdBlocker::Decision::Kind::kBlock ? "blocked"
                  : decision.kind == AdBlocker::Decision::Kind::kRedirect
                      ? "answered with a stand-in"
                      : "removed parameters from")
              << " a " << type << " request for "
              << request.url.possibly_invalid_spec() << " from "
              << checked_.page.possibly_invalid_spec() << " ("
              << AdBlockingModeName(checked_.mode)
              << (checked_.cookie_banners ? ", cookie banners hidden" : "")
              << ")";
    }
    return decision;
  }

  // CNAME uncloaking, as Brave does it: a request nothing blocked is checked
  // again under the canonical name its host resolves to, which finds a
  // tracker a site serves from a subdomain of its own. Only a request the
  // lists could block (another site's, or any in Strict) that goes straight
  // to its host by name.
  void Uncloak() {
    content::RenderFrameHost* frame = content::RenderFrameHost::FromID(frame_);
    namespace domains = net::registry_controlled_domains;
    const bool lists_apply =
        checked_.mode == AdBlockingMode::kStrict ||
        !domains::SameDomainOrHost(request_.url, checked_.page,
                                   domains::INCLUDE_PRIVATE_REGISTRIES);
    if (frame == nullptr || IsDocument(request_) || !lists_apply ||
        !request_.url.SchemeIsHTTPOrHTTPS() || request_.url.HostIsIPAddress()) {
      return StartOnTheNetwork();
    }
    anonymization_key_ =
        frame->GetIsolationInfoForSubresources().network_anonymization_key();
    frame->GetStoragePartition()->GetNetworkContext()->LookUpProxyForURL(
        request_.url, anonymization_key_,
        proxy_lookup_.BindNewPipeAndPassRemote());
    proxy_lookup_.set_disconnect_handler(base::BindOnce(
        &AdBlockingLoader::StartOnTheNetwork, base::Unretained(this)));
  }

  void Resolved(int result,
                const net::ResolveErrorInfo&,
                const net::AddressList& addresses,
                const net::HostResolverEndpointResults&) {
    resolver_.reset();
    const std::vector<std::string>& aliases = addresses.dns_aliases();
    if (result == net::OK && !aliases.empty() &&
        aliases.front() != request_.url.host()) {
      GURL::Replacements host;
      host.SetHostStr(aliases.front());
      network::ResourceRequest cloaked = request_;
      cloaked.url = request_.url.ReplaceComponents(host);
      if (Decide(cloaked).blocks()) {
        VLOG(1) << "domicile: ad blocking: " << request_.url.host() << " is "
                << aliases.front() << ", which is blocked";
        return Fail(net::ERR_BLOCKED_BY_CLIENT);
      }
    }
    StartOnTheNetwork();
  }

  void StartOnTheNetwork() {
    network_->CreateLoaderAndStart(network_loader_.BindNewPipeAndPassReceiver(),
                                   request_id_, options_, request_,
                                   network_client_.BindNewPipeAndPassRemote(),
                                   traffic_annotation_);
    network_client_.set_disconnect_handler(base::BindOnce(
        &AdBlockingLoader::Fail, base::Unretained(this), net::ERR_ABORTED));
  }

  // Answers with a `$redirect` rule's stand-in, as Brave's MakeStubResponse
  // does.
  void Stub(const GURL& data_url) {
    std::string mime_type;
    std::string charset;
    std::string data;
    if (!net::DataURL::Parse(data_url, &mime_type, &charset, &data)) {
      // adblock-rust builds it from the resources, so this is its bug.
      LOG(ERROR) << "domicile: ad blocking: a $redirect stand-in is no "
                    "data: URL, so the request is only blocked";
      return Fail(net::ERR_BLOCKED_BY_CLIENT);
    }
    Counted();
    mojo::ScopedDataPipeProducerHandle producer;
    mojo::ScopedDataPipeConsumerHandle consumer;
    if (mojo::CreateDataPipe(std::max<size_t>(data.size(), 1), producer,
                             consumer) != MOJO_RESULT_OK) {
      return Fail(net::ERR_INSUFFICIENT_RESOURCES);
    }
    auto head = network::mojom::URLResponseHead::New();
    head->headers = base::MakeRefCounted<net::HttpResponseHeaders>(
        net::HttpUtil::AssembleRawHeaders(
            base::StringPrintf("HTTP/1.1 200 OK\n"
                               "Content-Type: %s\n"
                               "Access-Control-Allow-Origin: *\n\n",
                               mime_type.c_str())));
    head->mime_type = mime_type;
    head->charset = charset;
    head->content_length = data.size();
    client_->OnReceiveResponse(std::move(head), std::move(consumer),
                               std::nullopt);
    producer->WriteAllData(base::as_byte_span(data));
    producer.reset();
    network::URLLoaderCompletionStatus status(net::OK);
    status.decoded_body_length = base::ByteSize(data.size());
    client_->OnComplete(status);
    Done();
  }

  // Redirects to `url` before the network sees the request, as Chrome's
  // webRequest does when an extension redirects one.
  void RedirectTo(const GURL& url) {
    constexpr int kStatus = net::HTTP_TEMPORARY_REDIRECT;
    const net::RedirectInfo redirect = net::RedirectInfo::ComputeRedirectInfo(
        request_.method, request_.url, request_.site_for_cookies,
        request_.update_first_party_url_on_redirect
            ? net::RedirectInfo::FirstPartyURLPolicy::UPDATE_URL_ON_REDIRECT
            : net::RedirectInfo::FirstPartyURLPolicy::NEVER_CHANGE_URL,
        request_.referrer_policy, request_.referrer.spec(),
        request_.request_initiator, kStatus, url,
        /*referrer_policy_header=*/std::nullopt,
        /*insecure_scheme_was_upgraded=*/false, /*copy_fragment=*/false,
        /*is_signed_exchange_fallback_redirect=*/false);
    std::string raw = base::StringPrintf(
        "HTTP/1.1 %i Internal Redirect\n"
        "Location: %s\n"
        "Non-Authoritative-Reason: Domicile ad blocking\n",
        kStatus, url.spec().c_str());
    // A cross-origin fetch's redirect is let through, as webRequest's is.
    if (request_.request_initiator.has_value() &&
        (request_.mode == network::mojom::RequestMode::kCors ||
         request_.mode ==
             network::mojom::RequestMode::kCorsWithForcedPreflight)) {
      raw += base::StringPrintf(
          "Access-Control-Allow-Origin: %s\n"
          "Access-Control-Allow-Credentials: true\n",
          request_.request_initiator->Serialize().c_str());
    }
    raw += "\n";
    auto head = network::mojom::URLResponseHead::New();
    head->headers = base::MakeRefCounted<net::HttpResponseHeaders>(
        net::HttpUtil::AssembleRawHeaders(raw));
    head->encoded_data_length = 0;
    rewritten_ = url;
    client_->OnReceiveRedirect(redirect, std::move(head));
  }

  void Fail(int error) {
    if (error == net::ERR_BLOCKED_BY_CLIENT) {
      Counted();
    }
    client_->OnComplete(network::URLLoaderCompletionStatus(error));
    Done();
  }

  // One more blocked on the page, for its shell's count. An Electron app's
  // page has no shield to count for.
  void Counted() {
    content::RenderFrameHost* frame = content::RenderFrameHost::FromID(frame_);
    if (frame == nullptr) {
      return;
    }
    content::WebContents* contents =
        content::WebContents::FromRenderFrameHost(frame);
    if (ElectronPage::SessionOf(*contents)) {
      return;
    }
    PagePrivacy::CreateForWebContents(contents);
    PagePrivacy::FromWebContents(contents)->CountBlocked();
  }

  void Done() { delete this; }

  const CheckedIn checked_;
  const content::GlobalRenderFrameHostId frame_;
  // For Uncloak's proxy lookup and its host's name, as the frame's own
  // requests are keyed.
  net::NetworkAnonymizationKey anonymization_key_;
  mojo::Receiver<network::mojom::ProxyLookupClient> proxy_lookup_{this};
  std::unique_ptr<network::SimpleHostResolver> resolver_;
  mojo::Remote<network::mojom::URLLoaderFactory> network_;
  const int32_t request_id_;
  const uint32_t options_;
  network::ResourceRequest request_;
  const net::MutableNetworkTrafficAnnotationTag traffic_annotation_;
  // The URL RedirectTo sent the page to, until the page follows.
  std::optional<GURL> rewritten_;

  mojo::Receiver<network::mojom::URLLoader> loader_;
  mojo::Remote<network::mojom::URLLoaderClient> client_;
  mojo::Remote<network::mojom::URLLoader> network_loader_;
  mojo::Receiver<network::mojom::URLLoaderClient> network_client_{this};
};

// Hands each request of one frame that is checked to an AdBlockingLoader,
// and the rest straight to the network. See ProxyAdBlocking.
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
    std::optional<CheckedIn> checked = CheckedInFor(frame_, request);
    if (!checked) {
      network_->CreateLoaderAndStart(std::move(loader), request_id, options,
                                     request, std::move(client),
                                     traffic_annotation);
      return;
    }
    mojo::PendingRemote<network::mojom::URLLoaderFactory> network;
    network_->Clone(network.InitWithNewPipeAndPassReceiver());
    // Owns itself: it goes when the request ends or either side does.
    (new AdBlockingLoader(*std::move(checked), frame_, std::move(network),
                          request_id, options, request, std::move(loader),
                          std::move(client), traffic_annotation))
        ->Start();
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
    const AdBlocker* blocker = AdBlocking::Get().blocker();
    if (blocker == nullptr) {
      return;
    }
    // The page's mode: for its main frame, the page about to commit's; for
    // a frame in it, the committed page's. An app may take a window over
    // after it was attached; its page is in no profile, and hides in
    // Standard, with no cookie banner lists, when the config asks.
    AdBlockingMode mode = AdBlockingMode::kOff;
    bool cookie_banners = false;
    if (ElectronPage::SessionOf(GetWebContents())) {
      if (AdBlocking::Get().blocks_electron_apps()) {
        mode = AdBlockingMode::kStandard;
      }
    } else {
      PagePrivacy::CreateForWebContents(&GetWebContents());
      const PagePrivacy& privacy =
          *PagePrivacy::FromWebContents(&GetWebContents());
      const bool main_frame = navigation->IsInPrimaryMainFrame();
      mode = main_frame ? privacy.ModeFor(url) : privacy.mode();
      cookie_banners =
          main_frame ? privacy.IsOnFor(PageProtection::kHideCookieBanners, url)
                     : privacy.IsOn(PageProtection::kHideCookieBanners);
    }
    if (mode == AdBlockingMode::kOff) {
      return;
    }
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
            << (cosmetics.procedural_filters.empty()
                    ? ""
                    : ", applying " +
                          base::NumberToString(
                              cosmetics.procedural_filters.size()) +
                          " procedural filters,")
            << " in " << url.possibly_invalid_spec() << " ("
            << AdBlockingModeName(mode)
            << (cookie_banners ? ", cookie banners hidden" : "") << ")";
    mojo::AssociatedRemote<mojom::CosmeticFilters> frame;
    navigation->GetRenderFrameHost()
        ->GetRemoteAssociatedInterfaces()
        ->GetInterface(&frame);
    frame->Hide(std::move(cosmetics.hide_selectors),
                std::move(cosmetics.script),
                std::move(cosmetics.procedural_filters), std::move(host));
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
  // Every frame of a guest, an Electron app's too: whether its requests are
  // checked is decided as each starts, by the config of the moment.
  if (content::WebContents::FromRenderFrameHost(frame) == nullptr) {
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
